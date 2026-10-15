const db = require('../../../database/db'); // 4 níveis acima para chegar à raiz do projeto ou 3 para src

// Consultar o saldo atual do utilizador
async function getBalance(userId) {
    return new Promise((resolve, reject) => {
        db.get(`SELECT balance FROM user_wallet WHERE user_id = ?`, [userId], (err, row) => {
            if (err) return reject(err);
            resolve(row ? row.balance : 0.00);
        });
    });
}

// Adicionar saldo (usado após aprovação de depósito Pix ou prêmio)
async function addBalance(userId, amount) {
    return new Promise((resolve, reject) => {
        db.run(
            `INSERT INTO user_wallet (user_id, balance) VALUES (?, ?) 
             ON CONFLICT(user_id) DO UPDATE SET balance = balance + ?`,
            [userId, amount, amount],
            function (err) {
                if (err) return reject(err);
                resolve(true);
            }
        );
    });
}

// Retirar/Descontar saldo (usado ao entrar na fila da aposta)
async function removeBalance(userId, amount) {
    const currentBalance = await getBalance(userId);
    if (currentBalance < amount) {
        return false; // Saldo insuficiente
    }

    return new Promise((resolve, reject) => {
        db.run(
            `UPDATE user_wallet SET balance = balance - ? WHERE user_id = ?`,
            [amount, userId],
            function (err) {
                if (err) return reject(err);
                resolve(true);
            }
        );
    });
}

module.exports = { getBalance, addBalance, removeBalance };