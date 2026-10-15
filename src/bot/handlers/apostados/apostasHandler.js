const { adicionarFila, removerFilaPorUsuario } = require('./matchManager');

async function handleApostasInteraction(interaction) {
    if (!interaction.isButton()) return;
    const customId = interaction.customId;

    if (customId.startsWith('entrar_')) {
        const parts = customId.split('_');
        const valorStr = parts[parts.length - 1];
        const formato = parts[parts.length - 2];
        const categoria = parts[parts.length - 3];
        
        const indexCategoria = parts.indexOf(categoria);
        const subRegra = parts.slice(1, indexCategoria).join('_'); 
        const valor = parseFloat(valorStr);

        // Pega exatamente o texto (label) escrito no botão em que o utilizador clicou (ex: "Gelo Normal", "Full Ump Xm8")
        const labelBotao = interaction.component.label || subRegra;

        await adicionarFila(interaction, categoria, formato, valor, subRegra, labelBotao);
    } 
    else if (customId.startsWith('sair_fila_')) {
        const parts = customId.split('_');
        const categoria = parts[2];
        const formato = parts[3];
        const valor = parseFloat(parts[4]);

        await removerFilaPorUsuario(interaction, categoria, formato, valor);
    }
    // No seu handleApostasInteraction ou equivalente:
if (interaction.customId === 'assumir_ticket') {
    if (!interaction.member.permissions.has('ManageChannels') && !interaction.member.permissions.has('Administrator')) {
        return interaction.reply({ content: '❌ Apenas membros da staff podem assumir este atendimento.', ephemeral: true });
    }

    const staffUser = interaction.user;

    const embedAntiga = interaction.message.embeds[0];
    const embedAtualizada = EmbedBuilder.from(embedAntiga)
        .setColor(0x10B981)
        .setDescription(`✅ Atendimento assumido por **<@${staffUser.id}>**!\n\n*Bom trabalho!*`);

    const rowDesativada = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId('assumir_ticket_feito')
            .setLabel(`Assumido por ${staffUser.username}`)
            .setStyle(ButtonStyle.Success)
            .setDisabled(true)
            .setEmoji('✅')
    );

    // Responde imediatamente à interação para evitar o erro de timeout
    await interaction.update({ embeds: [embedAtualizada], components: [rowDesativada] });
    
    await interaction.channel.setName(`atendido-${staffUser.username}`).catch(() => {});
    return;
}
}

module.exports = { handleApostasInteraction };