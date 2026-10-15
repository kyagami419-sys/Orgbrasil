const { MercadoPagoConfig, Payment, DisbursementClient } = require('mercadopago');

// Inicializa o cliente do Mercado Pago com o token do ficheiro .env
const client = new MercadoPagoConfig({ accessToken: process.env.MP_ACCESS_TOKEN });
const payment = new Payment(client);

async function criarCobrancaPix(valor, descricao, emailUsuario) {
    try {
        const body = {
            transaction_amount: Number(valor),
            description: descricao,
            payment_method_id: 'pix',
            payer: {
                email: emailUsuario || 'jogador@orgbrasil.com',
            },
        };

        const response = await payment.create({ body });
        
        return {
            id: response.id,
            status: response.status, // 'pending'
            qrCode: response.point_of_interaction.transaction_data.qr_code,
            qrCodeBase64: response.point_of_interaction.transaction_data.qr_code_base64,
            ticketUrl: response.point_of_interaction.transaction_data.ticket_url
        };
    } catch (error) {
        console.error('[MERCADO PAGO ERROR]', error.response?.data || error.message);
        return null;
    }
}

async function enviarPixVencedor(chavePix, tipoChave, valor, nomeDestinatario) {
    try {
        // Exemplo utilizando a API de pagamentos/transferências do Mercado Pago
        const response = await fetch('https://api.mercadopago.com/v1/payments', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${process.env.MP_ACCESS_TOKEN}`,
                'Content-Type': 'application/json',
                'X-Idempotency-Key': `payout-${Date.now()}`
            },
            body: JSON.stringify({
                transaction_amount: valor,
                description: `Premio Torneio - Vencedor ${nomeDestinatario}`,
                payment_method_id: 'pix',
                // Dependendo do seu painel do Mercado Pago, você envia os dados da chave Pix do destinatário
                payer: {
                    email: process.env.MP_MERCHANT_EMAIL // email da conta que envia
                },
                // Dados de destinação da chave Pix (conforme a modalidade de payout da sua conta)
            })
        });

        const data = await response.json();
        return data;
    } catch (error) {
        console.error('[ERRO API MERCADO PAGO - PAGAMENTO]', error);
        throw error;
    }
}

module.exports = { criarCobrancaPix, enviarPixVencedor };