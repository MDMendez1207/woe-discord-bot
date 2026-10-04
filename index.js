const { Client, GatewayIntentBits, EmbedBuilder } = require('discord.js');
const axios = require('axios');

const TOKEN = process.env.DISCORD_TOKEN; 
const CANAL_ID = process.env.CANAL_ID;
const ENDPOINT_URL = process.env.ENDPOINT_URL;
const INTERVALO_CHECK = 30000; // 30 segundos


const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages] });

/**
 * Mapa global para rastrear las partidas en memoria.
 * Key: Clave única de la partida (creada con started_at + mapa)
 * Value: {
 *   datos: { players, map, started_at, ladder_game },
 *   messageId: "id_del_mensaje_en_discord",
 *   finalizada: boolean,
 *   tiempoFinalizacion: timestamp o null
 * }
 */
const partidasActivas = new Map();

client.once('ready', () => {
    console.log(`Bot listo y conectado como: ${client.user.tag}`);
    
    // Primera ejecución y ciclo repetitivo
    verificarPartidas();
    setInterval(verificarPartidas, INTERVALO_CHECK);
});

// Función auxiliar para extraer el nombre del mapa limpio desde la ruta del servidor
function obtenerNombreMapa(rutaMapa) {
    if (!rutaMapa) return 'Mapa Desconocido';
    const partes = rutaMapa.split('/');
    return partes[partes.length - 1];
}

// Función auxiliar para formatear la lista de jugadores y sus datos
function formatearJugadores(players) {
    if (!players || players.length === 0) return 'Ninguno';
    return players.map(p => `• **${p.player}** (Team ${p.team})`).join('\n');
}

async function verificarPartidas() {
    try {
        const canal = await client.channels.fetch(CANAL_ID);
        if (!canal) return console.error('No se pudo encontrar el canal especificado.');

        // 1. Consultar el endpoint que devuelve la lista de partidas actuales
        const respuesta = await axios.get(ENDPOINT_URL);
        const partidasServidor = respuesta.data; // Array con la estructura de tu JSON

        const clavesServidorActuales = new Set();
        const ahora = Date.now();

        // 2. Procesar o actualizar las partidas que vienen del endpoint
        for (const partida of partidasServidor) {
            // Generamos un identificador único combinando el timestamp de inicio y el mapa
            const clavePartida = `${partida.started_at}_${partida.map}`;
            clavesServidorActuales.add(clavePartida);

            const mapaLimpio = obtenerNombreMapa(partida.map);
            const listaJugadores = formatearJugadores(partida.players);

            // Crear el diseño visual del mensaje (Embed)
            const embed = new EmbedBuilder()
                .setTitle(`🎮 Partida en Curso - Warcraft 3`)
                .setDescription(`El encuentro se está disputando actualmente.`)
                .setColor('#00ff00') // Verde para activo
                .addFields(
                    { name: '🗺️ Mapa', value: mapaLimpio, inline: true },
                    { name: '🏆 Modo', value: partida.ladder_game ? 'Ladder' : 'Custom', inline: true },
                    { name: `👥 Jugadores (${partida.players.length})`, value: listaJugadores }
                )
                .setTimestamp();

            if (partidasActivas.has(clavePartida)) {
                // Si ya existe en nuestro registro, actualizamos su contenido por si entraron/salieron jugadores
                const partidaGuardada = partidasActivas.get(clavePartida);
                
                // Evitamos editar si ya estaba marcada como finalizada (por un error de retraso del endpoint)
                if (!partidaGuardada.finalizada) {
                    try {
                        const msg = await canal.messages.fetch(partidaGuardada.messageId);
                        await msg.edit({ embeds: [embed] });
                    } catch (err) {
                        console.error(`Error al editar el mensaje de la partida ${clavePartida}:`, err);
                    }
                }
            } else {
                // Si es una partida completamente nueva, enviamos un mensaje exclusivo para ella
                try {
                    const nuevoMensaje = await canal.send({ embeds: [embed] });
                    
                    partidasActivas.set(clavePartida, {
                        datos: partida,
                        messageId: nuevoMensaje.id,
                        finalizada: false,
                        tiempoFinalizacion: null
                    });
                    console.log(`Mensaje creado para la nueva partida: ${mapaLimpio}`);
                } catch (err) {
                    console.error('Error al enviar el nuevo mensaje a Discord:', err);
                }
            }
        }

        // 3. Detectar partidas que terminaron (están en nuestra memoria pero ya no vienen en el JSON)
        for (const [clave, partidaGuardada] of partidasActivas.entries()) {
            
            if (!clavesServidorActuales.has(clave) && !partidaGuardada.finalizada) {
                // La partida acaba de finalizar en este ciclo de revisión
                partidaGuardada.finalizada = true;
                partidaGuardada.tiempoFinalizacion = ahora;

                const mapaLimpio = obtenerNombreMapa(partidaGuardada.datos.map);
                const listaJugadores = formatearJugadores(partidaGuardada.datos.players);

                // Modificamos el embed para reflejar que terminó
                const embedFinalizado = new EmbedBuilder()
                    .setTitle(`🏁 Partida Finalizada - Warcraft 3`)
                    .setDescription(`Esta partida ha concluido. Este mensaje se limpiará automáticamente en 1 hora.`)
                    .setColor('#ff0000') // Rojo para finalizado
                    .addFields(
                        { name: '🗺️ Mapa', value: mapaLimpio, inline: true },
                        { name: '🏆 Modo', value: partidaGuardada.datos.ladder_game ? 'Ladder' : 'Custom', inline: true },
                        { name: `👥 Jugadores Finales`, value: listaJugadores }
                    )
                    .setTimestamp();

                try {
                    const msg = await canal.messages.fetch(partidaGuardada.messageId);
                    await msg.edit({ embeds: [embedFinalizado] });
                    console.log(`Partida finalizada. Mensaje actualizado para: ${mapaLimpio}`);
                } catch (err) {
                    console.error(`No se pudo actualizar el mensaje de finalización para ${clave}:`, err);
                }
            }

            // 4. Limpieza: Si ya pasó 1 hora (3,600,000 ms) desde que finalizó, borramos el mensaje
            if (partidaGuardada.finalizada && (ahora - partidaGuardada.tiempoFinalizacion >= 3600000)) {
                try {
                    const msg = await canal.messages.fetch(partidaGuardada.messageId);
                    await msg.delete();
                    console.log(`Mensaje de partida antigua eliminado tras 1 hora de espera.`);
                } catch (err) {
                    // Si el mensaje ya fue borrado manualmente por un admin, ignoramos el error
                    console.log(`El mensaje ${partidaGuardada.messageId} ya no existía al intentar borrarlo.`);
                }
                // Lo removemos definitivamente de la memoria del bot
                partidasActivas.delete(clave);
            }
        }

    } catch (error) {
        console.error('Error general en el ciclo de verificación:', error.message);
    }
}

client.login(TOKEN);
