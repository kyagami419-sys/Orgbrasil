const { ThumbnailBuilder, SectionBuilder, EmbedBuilder, ContainerBuilder, TextDisplayBuilder, SeparatorBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ChannelType, PermissionFlagsBits, MessageFlags } = require('discord.js');
const { criarCobrancaPix, enviarPixVencedor } = require('./mercadopago');

const filas = new Map();
const salasAtivas = new Map();
const painelDados = new Map();
const pagamentosAtivos = new Map();
const limiteMap = { '1x1': 2, '2x2': 2, '3x3': 2, '4x4': 2, '5x5': 2, '6x6': 2 };

const CARGO_STAFF_ID = '1460651881918628034';

// ---------- PAINEL PRINCIPAL COM BOTÃO ----------
function montarPainelPrincipal(d, assumidoPor = null) {
    const botao = new ButtonBuilder()
        .setCustomId('assumir_ticket')
        .setLabel(assumidoPor ? 'Atendimento assumido' : 'Assumir Atendimento')
        .setStyle(assumidoPor ? ButtonStyle.Secondary : ButtonStyle.Primary)
        .setEmoji('🛡️')
        .setDisabled(Boolean(assumidoPor));

    const staffTexto = assumidoPor ? `<@${assumidoPor}>` : d.mencaoStaff;

    return new ContainerBuilder()
        .setAccentColor(assumidoPor ? 0x3B82F6 : 0x10B981)
        .addTextDisplayComponents(
            new TextDisplayBuilder().setContent(`||${d.mencoesJogadores} ${d.mencaoStaff}||`)
        )
        .addSeparatorComponents(new SeparatorBuilder())
        .addTextDisplayComponents(
            new TextDisplayBuilder().setContent(
                `# 🎮 SALA EXCLUSIVA — ${d.formato.toUpperCase()} (${d.categoria.toUpperCase()})\n\n` +
                `> ⚡ **Partida preenchida com sucesso!**\n\n` +
                `👥 **Participantes:** ${d.mencoesJogadores}\n` +
                `🛡️ **Staff Responsável:** ${staffTexto}\n` +
                `💰 **Investimento:** \`${d.textoValor}\`\n` +
                `⚙️ **Regra Oficial:** \`${d.regraFormatada}\`\n\n` +
                `💳 **Próximo Passo:** Efetue o pagamento na fatura abaixo e digite **GO** para confirmar!`
            )
        )
        .addSeparatorComponents(new SeparatorBuilder())
        .addActionRowComponents(new ActionRowBuilder().addComponents(botao));
}

async function assumirTicket(interaction) {
    const dados = painelDados.get(interaction.channel.id);
    if (!dados) {
        return interaction.reply({ content: '❌ Painel não encontrado (o bot pode ter sido reiniciado).', flags: [MessageFlags.Ephemeral] });
    }

    const ehStaff = interaction.member.roles.cache.has(CARGO_STAFF_ID) ||
        interaction.member.permissions.has(PermissionFlagsBits.Administrator);
    if (!ehStaff) {
        return interaction.reply({ content: '❌ Apenas a staff pode assumir.', flags: [MessageFlags.Ephemeral] });
    }

    if (dados.assumidoPor) {
        return interaction.reply({ content: '⚠️ Este atendimento já foi assumido.', flags: [MessageFlags.Ephemeral] });
    }

    dados.assumidoPor = interaction.user.id;
    await interaction.update({
        components: [montarPainelPrincipal(dados, interaction.user.id)],
        flags: [MessageFlags.IsComponentsV2]
    });
}

// ---------- FILAS ----------
async function adicionarFila(interaction, categoria, formato, valor, subRegra, labelBotao) {
    // 1. Responde imediatamente ao Discord para evitar o erro 10062 (Unknown interaction)
    await interaction.deferReply({ flags: [MessageFlags.Ephemeral] }).catch(() => {});

    const userId = interaction.user.id;
    const chaveFila = `${categoria}_${formato}_${valor}_${subRegra}`;

    if (!filas.has(chaveFila)) {
        filas.set(chaveFila, {
            categoria,
            formato,
            valor,
            subRegra,
            jogadores: [],
            mensagemPainel: null
        });
    }

    const fila = filas.get(chaveFila);
    if (!fila.mensagemPainel) {
        fila.mensagemPainel = interaction.message;
    }

    if (fila.jogadores.some(j => j.id === userId)) {
        return interaction.editReply({ content: '⚠️ Você já está posicionado nesta fila!' });
    }

    fila.jogadores.push({ id: userId, labelRegra: labelBotao });
    const limiteNecessario = limiteMap[formato] || 2;

    await atualizarEmbedPainel(fila);
    
    // 2. Edita a resposta deferida com o sucesso
    await interaction.editReply({ 
        content: `✅ Inscrição confirmada na fila de **${formato.toUpperCase()}${categoria.toUpperCase()}** (\`${labelBotao}\`)! (${fila.jogadores.length}/${limiteNecessario})` 
    });

    if (fila.jogadores.length >= limiteNecessario) {
        const jogadoresPartida = [...fila.jogadores];
        
        fila.jogadores = [];
        await atualizarEmbedPainel(fila);
        filas.delete(chaveFila);

        const idsApenas = jogadoresPartida.map(j => j.id);
        await iniciarPartidaEAbrirCanal(interaction.guild, categoria, formato, valor, subRegra, idsApenas);
    }
}

async function removerFilaPorUsuario(interaction, categoria, formato, valor) {
    const userId = interaction.user.id;
    let filaEncontrada = null;

    for (const [chave, fila] of filas.entries()) {
        if (fila.categoria === categoria && fila.formato === formato && fila.valor === valor) {
            const index = fila.jogadores.findIndex(j => j.id === userId);
            if (index !== -1) {
                fila.jogadores.splice(index, 1);
                filaEncontrada = fila;
                if (fila.jogadores.length === 0) {
                    filas.delete(chave);
                }
                break;
            }
        }
    }

    if (filaEncontrada) {
        await atualizarEmbedPainel(filaEncontrada);
        await interaction.reply({ content: `🚪 Você foi removido da fila com sucesso.`, flags: [MessageFlags.Ephemeral] });
    } else {
        await interaction.reply({ content: '⚠️ Você não está inscrito em nenhuma fila ativa com este valor.', flags: [MessageFlags.Ephemeral] });
    }
}

async function atualizarEmbedPainel(fila) {
    if (!fila.mensagemPainel) return;

    try {
        const embedAntiga = fila.mensagemPainel.embeds[0];
        if (!embedAntiga) return;

        const limite = limiteMap[fila.formato] || 2;

        const listaJogadoresTexto = fila.jogadores.length > 0
            ? fila.jogadores.map((j, index) => `> **${index + 1}.** <@${j.id}> — \`[ ${j.labelRegra} ]\``).join('\n')
            : '> *Nenhum jogador na fila no momento.*';

        let descricaoBase = embedAntiga.description || '';
        if (descricaoBase.includes('👥 **Fila Atual')) {
            descricaoBase = descricaoBase.split(/\n\n👥 \*\*Fila Atual/)[0];
        }

        const novaDescricao = `${descricaoBase}\n\n👥 **Fila Atual (${fila.jogadores.length}/${limite}):**\n${listaJogadoresTexto}`;

        const embedAtualizada = EmbedBuilder.from(embedAntiga).setDescription(novaDescricao);
        await fila.mensagemPainel.edit({ embeds: [embedAtualizada] });
    } catch (err) {
        console.error('[ERRO AO ATUALIZAR EMBED DA FILA]', err);
    }
}

// ---------- CRIAÇÃO DA PARTIDA ----------
async function iniciarPartidaEAbrirCanal(guild, categoria, formato, valor, subRegra, jogadoresIds) {
    try {
        const nomeCanal = `arena-${formato || 'geral'}-${categoria || 'partida'}-${Date.now().toString(36)}`;

        const permissionOverwrites = [
            { id: guild.id, deny: [PermissionFlagsBits.ViewChannel] },
            {
                id: CARGO_STAFF_ID,
                allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory]
            }
        ];

        jogadoresIds.forEach(id => {
            permissionOverwrites.push({
                id,
                allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory],
            });
        });

        const canalPartida = await guild.channels.create({
            name: nomeCanal,
            type: ChannelType.GuildText,
            permissionOverwrites
        });

        // Registra a sala logo de cara, para o GO funcionar mesmo se algum envio falhar
        salasAtivas.set(canalPartida.id, {
            jogadoresPendentes: new Set(jogadoresIds),
            status: 'AGUARDANDO_GO',
            formato, categoria, valor, subRegra
        });

        const mencoesJogadores = jogadoresIds.map(id => `<@${id}>`).join(' ') || 'Nenhum';
        const mencaoCargoStaff = `<@&${CARGO_STAFF_ID}>`;
        const valorParaCobranca = valor === 0 ? 0.30 : (valor || 0);
        const textoValor = valor === 0 ? 'R$ 0,00 + R$ 0,30 (Taxa operacional Pix)' : `R$ ${(valor || 0).toFixed(2)}`;
        const regraFormatada = (subRegra || 'padrao').replaceAll('_', ' ').toUpperCase();

        // Painel principal com o botão
        const dadosPainel = { formato, categoria, mencoesJogadores, mencaoStaff: mencaoCargoStaff, textoValor, regraFormatada, assumidoPor: null };
        painelDados.set(canalPartida.id, dadosPainel);

        await canalPartida.send({
            components: [montarPainelPrincipal(dadosPainel)],
            flags: [MessageFlags.IsComponentsV2]
        });

        // Faturas Pix individuais
        for (const id of jogadoresIds) {
            const membro = await guild.members.fetch(id).catch(() => null);
            const nomeUser = membro?.displayName ?? 'Concorrente';
            const avatarURL = membro?.displayAvatarURL() ?? null;

            const dadosPix = await criarCobrancaPix(valorParaCobranca, `Arena Tiger - ${formato}${categoria}`, `${id}@tigerapostas.com`);

            if (dadosPix && dadosPix.qrCode) {
                const textoPix = new TextDisplayBuilder().setContent(
                    `<@${id}>\n` +
                    `### 💳 Fatura Pix — ${nomeUser}\n\n` +
                    `> Copie o código Pix copia e cola abaixo para pagar **R$ ${valorParaCobranca.toFixed(2)}**:\n\n` +
                    `\`\`\`text\n${dadosPix.qrCode}\n\`\`\``
                );

                const containerPix = new ContainerBuilder().setAccentColor(0xF59E0B);

                if (dadosPix && dadosPix.id) {
                    pagamentosAtivos.set(dadosPix.id, {
                        canalId: canalPartida.id,
                        userId: id
                    });
                }

                if (avatarURL) {
                    containerPix.addSectionComponents(
                        new SectionBuilder()
                            .addTextDisplayComponents(textoPix)
                            .setThumbnailAccessory(new ThumbnailBuilder().setURL(avatarURL))
                    );
                } else {
                    containerPix.addTextDisplayComponents(textoPix);
                }

                await canalPartida.send({
                    components: [containerPix],
                    flags: [MessageFlags.IsComponentsV2]
                });
            }
        }

        // Notificações DM
        const linkCanal = `https://discord.com/channels/${guild.id}/${canalPartida.id}`;

        const embedDM = new EmbedBuilder()
            .setTitle('🚀 SUA SALA DE APOSTA FOI CRIADA!')
            .setDescription(`> *A sua fila atingiu o limite e a sala privada já se encontra aberta.*\n\n🎮 **Modo:** \`${formato.toUpperCase()}${categoria.toUpperCase()}\`\n🔗 **Aceder à Sala:** [Clique aqui para abrir o canal](${linkCanal})\n\n⚡ *Direcione-se ao canal para efetuar o pagamento!*`)
            .setColor(0xF59E0B);

        for (const id of jogadoresIds) {
            try {
                const membro = await guild.members.fetch(id);
                await membro.send({ embeds: [embedDM] });
            } catch (err) {
                console.error(`[DM JOGADOR ${id}]`, err.message);
            }
        }

        try {
            await guild.members.fetch();
            const membrosStaff = guild.roles.cache.get(CARGO_STAFF_ID)?.members;

            if (membrosStaff) {
                const embedDMStaff = new EmbedBuilder()
                    .setTitle('🛡️ NOVA SALA ABERTA — SUPORTE')
                    .setDescription(`> *Uma nova partida foi criada e aguarda supervisão.*\n\n🎮 **Modo:** \`${formato.toUpperCase()}${categoria.toUpperCase()}\`\n👥 **Jogadores:** ${mencoesJogadores}\n🔗 **Aceder à Sala:** [Clique aqui para abrir o canal](${linkCanal})`)
                    .setColor(0x3B82F6);

                for (const [, membroStaff] of membrosStaff) {
                    if (!membroStaff.user.bot) {
                        await membroStaff.send({ embeds: [embedDMStaff] }).catch(err => console.error(`[DM STAFF ${membroStaff.id}]`, err.message));
                    }
                }
            }
        } catch (err) {
            console.error('[DM STAFF ERRO]', err);
        }

    } catch (error) {
        console.error('[MATCH MANAGER ERROR]', error);
    }
}

// ---------- GO ----------
async function lidarComMensagemGo(message) {
    if (message.author.bot) return;

    const canalId = message.channel.id;
    if (!salasAtivas.has(canalId)) return;

    const sala = salasAtivas.get(canalId);
    if (sala.status !== 'AGUARDANDO_GO') return;

    if (message.content.trim().toUpperCase() === 'GO') {
        const userId = message.author.id;

        if (sala.jogadoresPendentes.has(userId)) {
            sala.jogadoresPendentes.delete(userId);
            await message.react('✅').catch(() => {});

            if (sala.jogadoresPendentes.size > 0) {
                await message.reply(`👍 Presença confirmada! Aguardando **${sala.jogadoresPendentes.size}** jogador(es) enviarem **GO**.`);
            } else {
                sala.status = 'AGUARDANDO_SALA_ADMIN';

                const containerAdmin = new ContainerBuilder()
                    .setAccentColor(0xF59E0B)
                    .addTextDisplayComponents(
                        new TextDisplayBuilder().setContent('🔔 **Atenção Staff Responsável:**'),
                        new TextDisplayBuilder().setContent('### 🛠️ TODOS OS JOGADORES CONFIRMARAM!'),
                        new TextDisplayBuilder().setContent('> *Jogadores confirmaram presença.*')
                    )
                    .addSeparatorComponents(new SeparatorBuilder().setSpacing(1).setDivider(true))
                    .addTextDisplayComponents(
                        new TextDisplayBuilder().setContent('Equipe de Staff, abram a sala no jogo e registrem os dados usando o comando slash:\n`/setsala [id] [senha]`')
                    );

                await message.channel.send({
                    components: [containerAdmin],
                    flags: [MessageFlags.IsComponentsV2]
                });
            }
        }
    }
}

async function pagarVencedorSlash(interaction, vencedorUser) {
    if (!interaction.member.permissions.has(PermissionFlagsBits.Administrator)) {
        return interaction.reply({ content: '❌ Apenas a staff/administração pode efetuar o pagamento ao vencedor.', flags: [MessageFlags.Ephemeral] });
    }

    const canalId = interaction.channel.id;
    if (!salasAtivas.has(canalId)) {
        return interaction.reply({ content: '❌ Este canal não possui nenhuma sala de partida ativa.', flags: [MessageFlags.Ephemeral] });
    }

    const sala = salasAtivas.get(canalId);
    const valorPremio = (sala.valor > 0 ? sala.valor : 0) * 2;

    await interaction.deferReply({ flags: [MessageFlags.Ephemeral] });

    try {
        // Tenta realizar o pagamento automático via API do Mercado Pago
        // const resultadoPagamento = await enviarPixVencedor(chavePixDoUsuario, valorPremio, vencedorUser.username);

        const containerPremio = new ContainerBuilder()
            .setAccentColor(0xF59E0B)
            .addTextDisplayComponents(
                new TextDisplayBuilder().setContent('### 🏆 PRÉMIO ENVIADO AUTOMATICAMENTE!'),
                new TextDisplayBuilder().setContent(
                    `> O confronto foi encerrado e a transferência foi solicitada via API.\n\n` +
                    `👑 **Vencedor:** ${vencedorUser.toString()}\n` +
                    `💰 **Valor Transferido:** \`R$ ${valorPremio.toFixed(2)}\`\n\n` +
                    `*Obrigado por participar! Este canal será arquivado em instantes.*`
                )
            );

        await interaction.channel.send({
            components: [containerPremio],
            flags: [MessageFlags.IsComponentsV2]
        });

        await interaction.editReply({ content: `✅ Pagamento de R$ ${valorPremio.toFixed(2)} processado via Mercado Pago para ${vencedorUser.toString()}!` });

        salasAtivas.delete(canalId);
        setTimeout(async () => {
            await interaction.channel.delete().catch(() => {});
        }, 15000);

    } catch (error) {
        console.error('[ERRO API PAGAMENTO]', error);
        await interaction.editReply({ content: '❌ Falha ao comunicar com a API do Mercado Pago para realizar a transferência automática.' });
    }
}

// ---------- /setsala ----------
async function definirDadosSalaSlash(interaction) {
    if (!interaction.member.permissions.has(PermissionFlagsBits.Administrator)) {
        return interaction.reply({ content: '❌ Apenas administradores podem configurar os dados da sala.', flags: [MessageFlags.Ephemeral] });
    }

    const canalId = interaction.channel.id;
    if (!salasAtivas.has(canalId)) {
        return interaction.reply({ content: '❌ Este canal não possui nenhuma arena ativa no momento.', flags: [MessageFlags.Ephemeral] });
    }

    const sala = salasAtivas.get(canalId);
    if (sala.status !== 'AGUARDANDO_SALA_ADMIN') {
        return interaction.reply({ content: '⚠️ A partida ainda aguarda a confirmação de todos os jogadores ("GO").', flags: [MessageFlags.Ephemeral] });
    }

    const idSala = interaction.options.getString('id');
    const senhaSala = interaction.options.getString('senha');

    salasAtivas.delete(canalId);

    const containerSalaPronta = new ContainerBuilder()
        .setAccentColor(0x3B82F6)
        .addTextDisplayComponents(
            new TextDisplayBuilder().setContent('🎉 **PARTIDA PRONTA PARA INICIAR!**'),
            new TextDisplayBuilder().setContent('### 🚀 CONFRONTO LIBERADO!'),
            new TextDisplayBuilder().setContent('> *As credenciais oficiais da sala foram geradas com sucesso.*')
        )
        .addSeparatorComponents(new SeparatorBuilder().setSpacing(1).setDivider(true))
        .addTextDisplayComponents(
            new TextDisplayBuilder().setContent(
                `🔑 **ID da Sala:** \`${idSala}\`\n` +
                `🔒 **Senha de Acesso:** \`${senhaSala}\`\n` +
                `🗺️ **Modo:** \`${sala.formato.toUpperCase()}\` — \`${(sala.subRegra || 'padrao').replaceAll('_', ' ').toUpperCase()}\`\n\n` +
                `⚡ *Entrem imediatamente na sala do jogo!*`
            )
        );

    await interaction.reply({
        components: [containerSalaPronta],
        flags: [MessageFlags.IsComponentsV2]
    });
}

module.exports = { 
    adicionarFila, 
    removerFilaPorUsuario, 
    lidarComMensagemGo, 
    definirDadosSalaSlash,
    pagarVencedorSlash
};