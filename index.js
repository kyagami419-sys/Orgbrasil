require('dotenv').config();
const { Client, GatewayIntentBits, SlashCommandBuilder, PermissionFlagsBits, MessageFlags } = require('discord.js');
const express = require('express');
const cors = require('cors');

const db = require('./src/database/db');
const { handleApostasInteraction } = require('./src/bot/handlers/apostados/apostasHandler');
const { gerarEmbedsPorCategoriaEModo } = require('./src/bot/handlers/apostados/painelBuilder');
const { adicionarFila, removerFilaPorUsuario, lidarComMensagemGo, definirDadosSalaSlash, pagarVencedorSlash } = require('./src/bot/handlers/apostados/matchManager');

const app = express();
app.use(express.json());
app.use(cors());

const configRoutes = require('./src/routes/config');
app.use('/api', configRoutes);

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent
    ]
});

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
        .setDescription('Envia o prêmio da partida (aposta x 2) para o jogador vencedor (Apenas Staff)')
        .addUserOption(o => o.setName('vencedor').setDescription('Jogador vencedor da partida').setRequired(true))
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator);

    try {
        await client.application.commands.set([setsala.toJSON(), pagarVencedor.toJSON()], process.env.GUILD_ID);
        console.log('[BOT] Comandos slash (/setsala, /pagarvencedor) registrados com sucesso.');
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
                return interaction.reply({ content: '❌ Apenas a staff pode assumir.', flags: MessageFlags.Ephemeral });
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
        const payload = { content: 'Ocorreu um erro ao processar esta interação.', flags: MessageFlags.Ephemeral };
        if (interaction.isRepliable()) {
            if (interaction.deferred || interaction.replied) await interaction.followUp(payload);
            else await interaction.reply(payload);
        }
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`[WEB] Servidor web / API a correr na porta ${PORT}`);
});

client.login(process.env.DISCORD_TOKEN);