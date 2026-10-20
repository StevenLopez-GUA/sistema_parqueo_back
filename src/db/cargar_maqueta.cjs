/**
 * Carga la semilla de la maqueta de 5 espacios (npm run bd:maqueta).
 *
 * Se puede correr más de una vez: la columna clave_sensor solo se agrega
 * si falta, y todo va en una transacción, así que si algo falla no se
 * borra nada.
 */
const Database = require('better-sqlite3');
const { readFileSync } = require('node:fs');
const { resolve } = require('node:path');

const db = new Database(process.env.RUTA_BD ?? resolve(__dirname, '../../parqueo.db'));
let sql = readFileSync(resolve(__dirname, 'semilla_maqueta.sql'), 'utf8');

const tieneColumna = db.prepare('PRAGMA table_info(espacio)').all().some((c) => c.name === 'clave_sensor');
if (tieneColumna) sql = sql.replace(/ALTER TABLE espacio ADD COLUMN clave_sensor TEXT;/, '');

// Dentro de una transacción el PRAGMA de la semilla no tiene efecto: se fija antes.
db.pragma('foreign_keys = OFF');
db.transaction(() => db.exec(sql))();
db.pragma('foreign_keys = ON');

const n = db.prepare('SELECT COUNT(*) AS n FROM espacio').get().n;
console.log(`maqueta de ${n} espacios cargada`);
