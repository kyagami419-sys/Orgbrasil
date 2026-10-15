const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const config = require('./precosEmbedsConfig.json');

function gerarEmbedsPorCategoriaEModo(categoriaAlvo, formatoAlvo) {
    const categoriaObj = config.categorias[categoriaAlvo];
    if (!categoriaObj) return [];

    const modoObj = categoriaObj[formatoAlvo];
    if (!modoObj) return [];

    const thumbnailUrl = 'https://cdn.discordapp.com/attachments/1558558041945935914/1558828642648330373/file_000000009408820e929f246d038c3b71.png?ex=6aced60e&is=6acd848e&hm=720f0bd25c816a8c5f5cf452f0d000df4f4ac8294547d587c4444f5a0754ded6&';
    const botoesConfig = modoObj.botoes || [];
    const opcoesOrdenadas = [...config.opcoes_preco_padrao].sort((a, b) => b.valor - a.valor);

    return opcoesOrdenadas.map(opcao => {
        const tituloCompleto = `⚔️ ${formatoAlvo.toUpperCase()} \vert{}${categoriaAlvo.toUpperCase()} — ARENA TIGER`;

        const embed = new EmbedBuilder()
            .setTitle(tituloCompleto)
            .setDescription(
                `> ✨ *Mostre sua habilidade e domine a competição!*\n\n` +
                `🎮 **Modo:** \`${modoObj.titulo_base}\`\n` +
                `💰 **Valor da Aposta:** \`R$ ${opcao.valor.toFixed(2).replace('.', ',')}\`\n\n` +
                `👥 **Fila Atual (0/${modoObj.limite_jogadores}):**\n` +
                `> *Nenhum jogador na fila no momento.*`
            )
            .setColor(0xF59E0B) // Cor Dourada/Tigre
            .setImage(thumbnailUrl)
            .setFooter({ text: 'Brasil Apostas • Sistema Oficial', iconURL: 'https://cdn.discordapp.com/emojis/1100000000000000000.png' })
            .setTimestamp();

        const row = new ActionRowBuilder();

        botoesConfig.forEach(btn => {
            row.addComponents(
                new ButtonBuilder()
                    .setCustomId(`entrar_${btn.sub_regra}_${categoriaAlvo}_${formatoAlvo}_${opcao.valor.toFixed(2)}`)
                    .setLabel(btn.label)
                    .setStyle(ButtonStyle.Success)
                    .setEmoji(btn.emoji || '⚔️')
            );
        });

        row.addComponents(
            new ButtonBuilder()
                .setCustomId(`sair_fila_${categoriaAlvo}_${formatoAlvo}_${opcao.valor.toFixed(2)}`)
                .setLabel('Sair da Fila')
                .setStyle(ButtonStyle.Danger)
                .setEmoji('🚪')
        );

        return {
            valor: opcao.valor,
            payload: { embeds: [embed], components: [row] }
        };
    });
}

module.exports = { gerarEmbedsPorCategoriaEModo };