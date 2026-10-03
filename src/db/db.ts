/**
 * Conexion a SQLite.
 * La primera vez que arranca, crea el archivo y ejecuta esquema.sql.
 */

import Database from 'better-sqlite3';
import { readFileSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const aqui = dirname(fileURLToPath(import.meta.url));

const RUTA_BD = process.env.RUTA_BD ?? resolve(aqui, '../../parqueo.db');
const RUTA_ESQUEMA = resolve(aqui, 'esquema.sql');

const esNueva = !existsSync(RUTA_BD);

export const db = new Database(RUTA_BD);

// SQLite no valida llaves foraneas si no se pide explicitamente.
db.pragma('foreign_keys = ON');
db.pragma('journal_mode = WAL');

if (esNueva) {
  console.log(`[bd] creando base de datos nueva en ${RUTA_BD}`);
  db.exec(readFileSync(RUTA_ESQUEMA, 'utf-8'));
} else {
  console.log(`[bd] usando base de datos existente en ${RUTA_BD}`);
}

/** Deja el parqueo como recien arrancado, sin borrar los catalogos. */
export function reiniciarParqueo(): void {
  const tx = db.transaction(() => {
    db.prepare('DELETE FROM bitacora').run();
    db.prepare('DELETE FROM alarma').run();
    db.prepare('DELETE FROM ocupacion').run();
    db.prepare('DELETE FROM vehiculo').run();
    db.prepare(
      `UPDATE espacio
          SET estado = 'LIBRE',
              sensor_ocupado = 0,
              actualizado_en = datetime('now','localtime')`
    ).run();
  });
  tx();
}
