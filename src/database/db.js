const fs = require('fs');
const path = require('path');
const initSqlJs = require('sql.js');

const dbPath = path.resolve(__dirname, 'database.sqlite');
let sqlDb = null;
const pendentes = [];
let saveTimer = null;

function salvarAgora() {
    if (!sqlDb) return;
    try { fs.writeFileSync(dbPath, Buffer.from(sqlDb.export())); }
    catch (e) { console.error('[DB SAVE]', e.message); }
}

function salvar() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(salvarAgora, 300);
}

const normalizar = (p) => (p === undefined || p === null) ? [] : (Array.isArray(p) ? p : [p]);

function executar(metodo, sql, params, cb) {
    if (typeof params === 'function') { cb = params; params = []; }

    const tarefa = () => {
        let erro = null;
        let resultado;
        try {
            const stmt = sqlDb.prepare(sql);
            try {
                const binds = normalizar(params);
                if (binds.length) stmt.bind(binds);

                if (metodo === 'run') {
                    stmt.step();
                    const changes = sqlDb.getRowsModified();
                    const r = sqlDb.exec('SELECT last_insert_rowid()');
                    resultado = { lastID: r[0].values[0][0], changes };
                    salvar();
                } else if (metodo === 'get') {
                    resultado = stmt.step() ? stmt.getAsObject() : undefined;
                } else {
                    resultado = [];
                    while (stmt.step()) resultado.push(stmt.getAsObject());
                }
            } finally {
                stmt.free();
            }
        } catch (e) {
            erro = e;
        }

        if (cb) {
            if (metodo === 'run') cb.call(resultado || {}, erro);
            else cb(erro, resultado);
        } else if (erro) {
            console.error('[DB ERROR]', erro.message);
        }
    };

    if (sqlDb) tarefa();
    else pendentes.push(tarefa);
}

const db = {
    serialize: (fn) => { if (fn) fn(); },
    run: (sql, params, cb) => { executar('run', sql, params, cb); return db; },
    get: (sql, params, cb) => { executar('get', sql, params, cb); return db; },
    all: (sql, params, cb) => { executar('all', sql, params, cb); return db; }
};

initSqlJs().then((SQL) => {
    const arquivo = fs.existsSync(dbPath) ? fs.readFileSync(dbPath) : undefined;
    sqlDb = new SQL.Database(arquivo);

    sqlDb.run(`CREATE TABLE IF NOT EXISTS server_settings (
        server_id TEXT PRIMARY KEY,
        reg_channel_id TEXT,
        reg_log_channel_id TEXT,
        reg_approval_channel_id TEXT,
        reg_title TEXT,
        reg_description TEXT,
        reg_embed_color TEXT,
        reg_initial_role TEXT,
        reg_approved_role TEXT,
        nickname_format TEXT,
        web_log_webhook TEXT
    )`);
    sqlDb.run(`CREATE TABLE IF NOT EXISTS user_wallet (
        user_id TEXT PRIMARY KEY,
        balance REAL DEFAULT 0.00
    )`);
    sqlDb.run(`CREATE TABLE IF NOT EXISTS ff_fila (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        server_id TEXT,
        categoria TEXT,
        formato TEXT,
        valor REAL,
        sub_regra TEXT,
        user_id TEXT
    )`);
    salvarAgora();

    console.log('[DB] SQLite (sql.js) carregado com sucesso.');
    while (pendentes.length) pendentes.shift()();
}).catch((e) => console.error('[DB ERROR] Falha ao iniciar sql.js:', e));

// Garante que nada se perca ao desligar/reiniciar
process.on('exit', salvarAgora);
process.on('SIGINT', () => process.exit(0));
process.on('SIGTERM', () => process.exit(0));

module.exports = db;