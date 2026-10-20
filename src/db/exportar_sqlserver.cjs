/**
 * Copia los datos de parqueo.db a un script T-SQL (npm run bd:sqlserver).
 *
 * Genera src/db/sqlserver/datos.sql con los INSERT de todas las tablas,
 * listo para correr en SQL Server despues de sqlserver/esquema.sql.
 * SQLite sigue siendo la base de la app; esto es la copia para SQL Server.
 */
const Database = require('better-sqlite3');
const { writeFileSync } = require('node:fs');
const { resolve } = require('node:path');

const db = new Database(process.env.RUTA_BD ?? resolve(__dirname, '../../parqueo.db'), { readonly: true });
const salida = resolve(__dirname, 'sqlserver/datos.sql');

// Orden de las llaves foraneas: padres primero.
const TABLAS = ['tipo_vehiculo', 'tipo_espacio', 'compatibilidad', 'espacio', 'vehiculo',
                'reserva', 'ocupacion', 'alarma', 'bitacora', 'captura'];

const literal = (v) =>
  v === null ? 'NULL' : typeof v === 'number' ? String(v) : `N'${String(v).replace(/'/g, "''")}'`;

const sql = [
  '-- Generado por `npm run bd:sqlserver` desde parqueo.db. No editar a mano.',
  'USE ParqueoUMG;', 'GO', 'SET XACT_ABORT ON;', 'BEGIN TRANSACTION;',
  ...[...TABLAS].reverse().map((t) => `DELETE FROM ${t};`),
];

for (const tabla of TABLAS) {
  const filas = db.prepare(`SELECT * FROM ${tabla}`).all();
  if (!filas.length) continue;
  const columnas = Object.keys(filas[0]);
  const conId = columnas.includes('id'); // las tablas con id usan IDENTITY
  if (conId) sql.push(`SET IDENTITY_INSERT ${tabla} ON;`);
  // SQL Server acepta maximo 1000 filas por INSERT ... VALUES
  for (let i = 0; i < filas.length; i += 1000) {
    const valores = filas.slice(i, i + 1000).map((f) => `  (${columnas.map((c) => literal(f[c])).join(', ')})`);
    sql.push(`INSERT INTO ${tabla} (${columnas.join(', ')}) VALUES\n${valores.join(',\n')};`);
  }
  if (conId) sql.push(`SET IDENTITY_INSERT ${tabla} OFF;`);
  console.log(`${tabla}: ${filas.length} filas`);
}

sql.push('COMMIT;', 'GO', '');
writeFileSync(salida, sql.join('\n'));
console.log(`listo: ${salida}`);
