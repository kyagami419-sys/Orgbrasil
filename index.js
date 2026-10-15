require('dotenv').config();
const {
    Client,
    GatewayIntentBits,
    SlashCommandBuilder,
    PermissionFlagsBits,
    MessageFlags
} = require('discord.js');
const express = require('express');
const cors = require('cors');

require('./src/database/db');
const { handleApostasInteraction } = require('./src/bot/handlers/apostados/apostasHandler');
const { gerarEmbedsPorCategoriaEModo } = require('./src/bot/handlers/apostados/painelBuilder');
const {
    lidarComMensagemGo,
    definirDadosSalaSlash,
    pagarVencedorSlash,
    processarPagamentoMercadoPago
} = require('./src/bot/handlers/apostados/matchManager');
const {
    consultarPagamento,
    validarWebhookMercadoPago
} = require('./src/bot/handlers/apostados/mercadopago');

const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(cors());

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent
    ]
});

// ---------------------------------------------------------
// WEB / API
// ---------------------------------------------------------

app.get('/', (req, res) => {
    res.status(200).json({
        status: 'online',
        service: 'Org Brasil Valkyria API',
        discord: client.user ? `online como ${client.user.tag}` : 'conectando',
        webhook_mercado_pago: '/webhook/mercadopago'
    });
});

app.get('/health', (req, res) => {
    res.status(200).json({
        ok: true,
        uptime: Math.floor(process.uptime()),
        timestamp: new Date().toISOString()
    });
});

/**
 * Webhook de pagamentos do Mercado Pago.
 * URL para cadastrar no painel do Mercado Pago:
 * https://orgbrasilvalkyria.discloud.app/webhook/mercadopago
 */
app.post('/webhook/mercadopago', async (req, res) => {
    try {
        const dataId = String(
            req.query['data.id'] ||
            req.body?.data?.id ||
            req.body?.id ||
            ''
        );

        const eventType = String(
            req.query.type ||
            req.query.topic ||
            req.body?.type ||
            ''
        ).toLowerCase();

        const action = String(req.body?.action || '').toLowerCase();

        // Se uma chave secreta estiver configurada, valida a origem da notificação.
        const validacao = validarWebhookMercadoPago({
            xSignature: req.headers['x-signature'],
            xRequestId: req.headers['x-request-id'],
            dataId
        });

        if (!validacao.valid) {
            console.warn('[MP WEBHOOK] Assinatura inválida. Notificação recusada.');
            return res.status(401).json({ ok: false, error: 'invalid_signature' });
        }

        // O Mercado Pago precisa receber 2xx rapidamente.
        res.status(200).json({ received: true });

        const ehPagamento =
            eventType === 'payment' ||
            action.startsWith('payment.');

        if (!ehPagamento || !dataId) {
            console.log(`[MP WEBHOOK] Evento ignorado: type=${eventType || 'n/a'} action=${action || 'n/a'} id=${dataId || 'n/a'}`);
            return;
        }

        // Processamento fora da resposta HTTP para evitar timeout do webhook.
        setImmediate(async () => {
            try {
                const pagamento = await consultarPagamento(dataId);
                await processarPagamentoMercadoPago(client, pagamento);
            } catch (error) {
                console.error('[MP WEBHOOK PROCESSAMENTO]', error?.response?.data || error?.message || error);
            }
        });
    } catch (error) {
        console.error('[MP WEBHOOK ERROR]', error?.message || error);
        if (!res.headersSent) {
            return res.status(500).json({ ok: false });
        }
    }
});

const configRoutes = require('./src/routes/config');
app.use('/api', configRoutes);

// ---------------------------------------------------------
// DISCORD
// ---------------------------------------------------------

client.once('clientReady', async () => {
    console.log(`[BOT] Bot iniciado com sucesso como ${client.user.tag}!`);

    const setsala = new SlashCommandBuilder()
        .setName('setsala')
        .setDescription('Define o ID e a senha da sala da partida')
        .addStringOption(o => o.setName('id').setDescription('ID da sala').setRequired(true))
        .addStringOption(o => o.setName('senha').setDescription('Senha da sala').setRequired(true))
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator);

    const pagarVencedor = new SlashCommandBuilder()
        .setName('pagarvencedor')
        .setDescription('Exibe o valor do prêmio e orienta a staff sobre o pagamento ao vencedor')
        .addUserOption(o => o.setName('vencedor').setDescription('Jogador vencedor da partida').setRequired(true))
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator);

    try {
        if (process.env.GUILD_ID) {
            await client.application.commands.set(
                [setsala.toJSON(), pagarVencedor.toJSON()],
                process.env.GUILD_ID
            );
            console.log('[BOT] Comandos slash registrados no servidor configurado.');
        } else {
            await client.application.commands.set([setsala.toJSON(), pagarVencedor.toJSON()]);
            console.log('[BOT] GUILD_ID não definido; comandos slash registrados globalmente.');
        }
    } catch (err) {
        console.error('[COMANDOS ERRO]', err);
    }
});

client.on('messageCreate', async (message) => {
    if (message.author.bot) return;

    await lidarComMensagemGo(message);

    if (message.content === '!enviar_painel_1x1') {
        if (!message.member.permissions.has('Administrator')) {
            return message.reply('❌ Apenas administradores podem usar este comando.');
        }

        const paineisPrecos = gerarEmbedsPorCategoriaEModo('mobile', '1x1');

        if (paineisPrecos.length === 0) {
            return message.reply('⚠️ Nenhuma embed encontrada no JSON para "mobile 1x1".');
        }

        for (const painel of paineisPrecos) {
            await message.channel.send(painel.payload);
        }

        await message.delete().catch(() => {});
        return;
    }

    if (message.content.startsWith('!enviar ')) {
        if (!message.member.permissions.has('Administrator')) return;

        const args = message.content.split(' ');
        const categoria = args[1];
        const formato = args[2];

        const paineis = gerarEmbedsPorCategoriaEModo(categoria, formato);
        if (!paineis || paineis.length === 0) {
            return message.reply('❌ Categoria ou formato inválidos. Use ex: `!enviar mobile 1x1`');
        }

        for (const painel of paineis) {
            await message.channel.send(painel.payload);
        }

        await message.delete().catch(() => {});
        return;
    }
});

client.on('interactionCreate', async (interaction) => {
    try {
        if (interaction.isChatInputCommand()) {
            if (interaction.commandName === 'setsala') {
                return await definirDadosSalaSlash(interaction);
            }
            if (interaction.commandName === 'pagarvencedor') {
                const vencedorUser = interaction.options.getUser('vencedor');
                return await pagarVencedorSlash(interaction, vencedorUser);
            }
        }

        if (interaction.isButton() && interaction.customId === 'assumir_ticket') {
            if (!interaction.member.roles.cache.has('1460651881918628034') &&
                !interaction.member.permissions.has(PermissionFlagsBits.Administrator)) {
                return interaction.reply({
                    content: '❌ Apenas a staff pode assumir.',
                    flags: MessageFlags.Ephemeral
                });
            }
            return interaction.reply({ content: `🛡️ ${interaction.user} assumiu este atendimento.` });
        }

        if (interaction.isButton() && (
            interaction.customId.startsWith('entrar_') ||
            interaction.customId.startsWith('sair_fila_') ||
            interaction.customId.startsWith('aprovar_vitoria_') ||
            interaction.customId.startsWith('recusar_vitoria_')
        )) {
            return await handleApostasInteraction(interaction);
        }
    } catch (error) {
        console.error('[INTERACTION ERROR]', error);
        const payload = {
            content: 'Ocorreu um erro ao processar esta interação.',
            flags: MessageFlags.Ephemeral
        };
        if (interaction.isRepliable()) {
            if (interaction.deferred || interaction.replied) await interaction.followUp(payload);
            else await interaction.reply(payload);
        }
    }
});

client.on('error', error => console.error('[DISCORD CLIENT ERROR]', error));
process.on('unhandledRejection', error => console.error('[UNHANDLED REJECTION]', error));
process.on('uncaughtException', error => console.error('[UNCAUGHT EXCEPTION]', error));

// ---------------------------------------------------------
// DISCLOUD: TYPE=site exige 0.0.0.0:8080
// ---------------------------------------------------------
const PORT = 8080;
const HOST = '0.0.0.0';

app.listen(PORT, HOST, () => {
    console.log(`[WEB] API online em http://${HOST}:${PORT}`);
    console.log('[WEB] Público: https://orgbrasilvalkyria.discloud.app');
    console.log('[WEB] Mercado Pago: /webhook/mercadopago');
});

const discordToken = String(process.env.DISCORD_TOKEN || '').trim();
if (!discordToken) {
    console.error('[BOT] DISCORD_TOKEN não definido. A API web continuará online, mas o bot não conectará ao Discord.');
} else {
    client.login(discordToken).catch(error => {
        console.error('[BOT LOGIN ERROR]', error);
    });
}
