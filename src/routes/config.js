const express = require('express');
const router = express.Router();
const db = require('../database/db'); // Ajuste o caminho do db.js conforme a localização exata deste ficheiro de rotas

// Rota para buscar as configurações do servidor
router.get('/config/:serverId', (req, res) => {
    const { serverId } = req.params;
    db.get(`SELECT * FROM server_settings WHERE server_id = ?`, [serverId], (err, row) => {
        if (err) {
            return res.status(500).json({ error: err.message });
        }
        res.json(row || {});
    });
});

// Rota para salvar ou atualizar as configurações do servidor a partir do painel web
router.post('/config/:serverId', (req, res) => {
    const { serverId } = req.params;
    const {
        reg_channel_id,
        reg_log_channel_id,
        reg_approval_channel_id,
        reg_title,
        reg_description,
        reg_embed_color,
        reg_initial_role,
        reg_approved_role,
        nickname_format
    } = req.body;

    const query = `
        INSERT INTO server_settings (
            server_id, reg_channel_id, reg_log_channel_id, reg_approval_channel_id, 
            reg_title, reg_description, reg_embed_color, reg_initial_role, 
            reg_approved_role, nickname_format
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(server_id) DO UPDATE SET
            reg_channel_id = excluded.reg_channel_id,
            reg_log_channel_id = excluded.reg_log_channel_id,
            reg_approval_channel_id = excluded.reg_approval_channel_id,
            reg_title = excluded.reg_title,
            reg_description = excluded.reg_description,
            reg_embed_color = excluded.reg_embed_color,
            reg_initial_role = excluded.reg_initial_role,
            reg_approved_role = excluded.reg_approved_role,
            nickname_format = excluded.nickname_format
    `;

    db.run(query, [
        serverId, reg_channel_id, reg_log_channel_id, reg_approval_channel_id,
        reg_title, reg_description, reg_embed_color, reg_initial_role,
        reg_approved_role, nickname_format
    ], function(err) {
        if (err) {
            return res.status(500).json({ error: err.message });
        }
        res.json({ success: true, message: 'Configurações atualizadas com sucesso!' });
    });
});

// OBRIGATÓRIO: Exportar o router para o Express reconhecê-lo no index.js
module.exports = router;