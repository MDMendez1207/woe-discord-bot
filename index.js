const { Client, GatewayIntentBits, EmbedBuilder } = require('discord.js');
const axios = require('axios');
require('dotenv').config({ path: `${__dirname}/.env` });

const TOKEN = process.env.DISCORD_TOKEN;
const CANAL_ID = process.env.CANAL_ID;
const ENDPOINT_PLAYING = process.env.ENDPOINT_PLAYING;
const ENDPOINT_EN_COLA = process.env.ENDPOINT_EN_COLA;
const ENDPOINT_GAMES = process.env.ENDPOINT_GAMES;
const INTERVALO_CHECK = 10000; // 10 segundos


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
const jugadoresEnCola = new Map();

client.once('clientReady', () => {
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

async function buscarEnGames(name) {
    try {
        const respuestaGames = await axios.get(ENDPOINT_GAMES);
        const gamesData = respuestaGames.data;

        for (const partida of gamesData) {
            if (partida.name === name) {
                return partida;
            }
        }
    } catch (error) {
        console.error(error);
    }



    return null;
}

// Función auxiliar para formatear la lista de jugadores y sus datos
function formatearJugadores(players) {
    if (!players || players.length === 0) return 'Ninguno';

    return players.map(p => {
        let raceEmoji = "";
        switch (p.race) {
            case 1: // hu
                raceEmoji = "<:PurgaFeliz:959908470797242368>";
                break;
            case 2: //orc
                raceEmoji = "<:Gromm:955765331337572374>";
                break;
            case 4: // nelf
                raceEmoji = "<:TrueJackson:1439319760834789478>";
                break;
            case 8: //und
                raceEmoji = "<:PurgaTriste:964600821553700954>";
                break;
            case 32: // random
                raceEmoji = "<:Meeh:1246086253812646020>";
                break;
            default:
                raceEmoji = "<:WorldEdit:733005872871112716>";
        }

        return `${raceEmoji} **${p.player}** (Equipo ${p.team + 1})`
    }).join('\n');
}

function formatearJugadoresEnd(data) {
    const players = data.player_names;
    const leaveCodes = data.player_leave_codes;
    let returnBuild = "";
    if (!players || players.length === 0) return 'Ninguno';

    let i = 0;
    while (i < players.length) {
        if (leaveCodes[i] == 9) {
            returnBuild += "🏅"
        } else {
            returnBuild += "🥉"
        }
        returnBuild += players[i] + "\n";
        i++;
    }
    return returnBuild;
}

function obtenerNombreLobby(name) {
    if (name == null) return 'Nombre no encontrado';

    const noNumber = name.indexOf(" ");
    if (noNumber == -1) return "Ladder match"
    return name.slice(noNumber, name.length)
}

async function verificarPartidas() {
    try {
        const canal = await client.channels.fetch(CANAL_ID);
        if (!canal) return console.error('No se pudo encontrar el canal especificado.');

        // 1. Consultar el endpoint que devuelve la lista de partidas actuales
        const respuestaPlaying = await axios.get(ENDPOINT_PLAYING);
        const partidasServidor = respuestaPlaying.data; // Array con la estructura de tu JSON

        const respuestaQueue = await axios.get(ENDPOINT_EN_COLA);
        const playersQueue = respuestaQueue.data;

        const clavesServidorActuales = new Set();
        const ahora = Date.now();

        for (const [nombre, old] of jugadoresEnCola.entries()) {
            old.refreshed = false;
        }

        for (const jugador of playersQueue) {
            const nombre = jugador.player;
            const tipo = jugador.game_type;
            let raceEmoji;
            if (!jugadoresEnCola.has(nombre)) {
                switch (jugador.race) {
                case 1: // hu
                    raceEmoji = "<:PurgaFeliz:959908470797242368>";
                    break;
                case 2: //orc
                    raceEmoji = "<:Gromm:955765331337572374>";
                    break;
                case 4: // nelf
                    raceEmoji = "<:TrueJackson:1439319760834789478>";
                    break;
                case 8: //und
                    raceEmoji = "<:PurgaTriste:964600821553700954>";
                    break;
                case 32: // random
                    raceEmoji = "<:Meeh:1246086253812646020>";
                    break;
                default:
                    raceEmoji = "<:WorldEdit:733005872871112716>";
            }

            let tipoValue;
            switch (tipo) {
                case 1:
                    tipoValue = "1v1";
                    break;
                case 2:
                    tipoValue = "2v2";
                    break;
                case 3:
                    tipoValue = "DotA";
                    break;
                default:
                    tipoValue = "Ni idea mi brother";
            }

            const embed = new EmbedBuilder()
                .setTitle("Jugador esperando en la Daga")
                .setColor('#0059ff') // Verde para activo
                .addFields(
                    { name: '👥 Jugador', value: raceEmoji + nombre, inline: true },
                    { name: '🏆 Modo', value: tipoValue, inline: true },
                )
                .setTimestamp();
            try {
                const nuevoMensaje = await canal.send({ embeds: [embed] });

                jugadoresEnCola.set(nombre, {
                    datos: jugador,
                    messageId: nuevoMensaje.id,
                    refreshed: true
                });
                console.log(`Mensaje creado para la cola de: ${nombre}`);
            } catch (err) {
                console.error('Error al enviar el nuevo mensaje a Discord:', err);
            }
            
        } else {
            jugadoresEnCola.set(nombre, {
                    datos: jugador,
                    messageId: jugadoresEnCola.get(nombre).messageId,
                    refreshed: true
                });
        }
        }

        for (const [nombre, old] of jugadoresEnCola.entries()) {
            try {
                if (old.refreshed==false) {
                    const msg = await canal.messages.fetch(old.messageId);
                    await msg.delete();
                    console.log(`Mensaje borrado para la cola de: ${nombre}`);
                    jugadoresEnCola.delete(nombre);
                }
                
            } catch (err) {
                console.error(
                    `No se pudo eliminar el mensaje de la cola de ${nombre}:`,
                    err.message
                );
            }
        }

        // 2. Procesar o actualizar las partidas que vienen del endpoint
        for (const partida of partidasServidor) {
            // Generamos un identificador único combinando el timestamp de inicio y el mapa
            const clavePartida = partida.name;//`${partida.started_at}_${partida.map}`;
            clavesServidorActuales.add(clavePartida);
            
            const mapaLimpio = obtenerNombreMapa(partida.map);
            const listaJugadores = formatearJugadores(partida.players);
            const timestampSegundos = Math.floor(partida.started_at / 1000000);
            const formatoHoraDiscord = `<t:${timestampSegundos}:t>`;
            // Crear el diseño visual del mensaje (Embed)
            let title = "";
            let color = '';
            let nombreLobby = obtenerNombreLobby(partida.name);
            if (partida.started_at == 0) {
                title = `🎮 Lobby en espera`;
                color = '#ffcc00'
            } else {
                title = `🎮 Partida en curso`;
                color = '#00ff00'
            }

            const embed = new EmbedBuilder()
                .setTitle(title)
                .setColor(color) // Verde para activo
                .addFields(
                    { name: '🗺️ Partida', value: nombreLobby, inline: true },
                    { name: '🗺️ Mapa', value: mapaLimpio, inline: false },
                    { name: '🏆 Modo', value: partida.ladder_game ? 'Ladder' : 'Custom', inline: true },
                    { name: `👥 Jugadores (${partida.players.length})`, value: listaJugadores }
                )
                .setTimestamp();

            if (partida.started_at != 0) embed.addFields({ name: '⌛ Empezó a las', value: formatoHoraDiscord, inline: true });

            if (partidasActivas.has(clavePartida)) {
                // Si ya existe en nuestro registro, actualizamos su contenido por si entraron/salieron jugadores
                const partidaGuardada = partidasActivas.get(clavePartida);

                // Evitamos editar si ya estaba marcada como finalizada (por un error de retraso del endpoint)
                if (!partidaGuardada.finalizada) {
                    partidaGuardada.datos = partida;
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
                const started_at = partidaGuardada.datos.started_at;
                const mapaLimpio = obtenerNombreMapa(partidaGuardada.datos.map);
                let title = started_at == 0 ? `🏁 Lobby cerrado` : `🏁 Partida Finalizada`
                if (started_at == 0) {
                    const embedFinalizado = new EmbedBuilder()
                        .setTitle(title)
                        .setColor('#ff0000') // Rojo para finalizado
                        .addFields(
                            { name: '🗺️ Mapa', value: mapaLimpio, inline: true },
                        )
                        .setTimestamp();

                    try {
                        const msg = await canal.messages.fetch(partidaGuardada.messageId);
                        await msg.edit({ embeds: [embedFinalizado] });
                        console.log(`Partida finalizada. Mensaje actualizado para: ${mapaLimpio}`);
                    } catch (err) {
                        console.error(`No se pudo actualizar el mensaje de finalización para ${clave}:`, err);
                    }
                } else {
                    const partidaData = await buscarEnGames(clave);
                    let listaJugadores = "Ninguno";
                    if (partidaData != null) {
                        listaJugadores = formatearJugadoresEnd(partidaData);
                    }


                    const embedFinalizado = new EmbedBuilder()
                        .setTitle(title)
                        .setColor('#ff0000') // Rojo para finalizado
                        .addFields(
                            { name: '🗺️ Mapa', value: mapaLimpio, inline: true },
                            { name: '🏆 Modo', value: partidaGuardada.datos.ladder_game ? 'Ladder' : 'Custom', inline: true },
                            { name: `👥 Jugadores`, value: listaJugadores }

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


            }

            // 4. Limpieza: Si ya pasó 1 hora (3,600,000 ms) desde que finalizó, borramos el mensaje
            if (partidaGuardada.finalizada && (ahora - partidaGuardada.tiempoFinalizacion >= 1800000)) {
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
