/**
 * SERVICIO DE CAPTURAS
 *
 * Responsabilidad: recibir una imagen desde el navegador, guardarla
 * en disco de forma organizada y registrar sus metadatos en SQLite.
 *
 * La imagen NO entra a la base de datos. En disco quedan asi:
 *
 *   capturas/2026-10-12/143052_REGISTRO_P123ABC.jpg
 *
 * El nombre lleva hora, motivo y placa, de modo que la carpeta es
 * legible aunque alguien la abra sin la aplicacion.
 */

import { db } from '../db/db.js';
import { mkdirSync, writeFileSync, existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const aqui = dirname(fileURLToPath(import.meta.url));

/** Carpeta raiz donde viven los archivos. Configurable por entorno. */
export const RAIZ_CAPTURAS =
  process.env.RUTA_CAPTURAS ?? resolve(aqui, '../../capturas');

export type MotivoCaptura = 'REGISTRO' | 'LLEGADA' | 'ALARMA' | 'SALIDA' | 'MANUAL';
export type MetodoLectura = 'QR' | 'OCR' | 'MANUAL' | 'NINGUNO';

export interface DatosCaptura {
  /** data URL completo o base64 pelado */
  imagen: string;
  motivo: MotivoCaptura;
  placaDetectada?: string | null;
  placaConfirmada?: string | null;
  metodoLectura?: MetodoLectura;
  confianza?: number | null;
  ancho?: number | null;
  alto?: number | null;
  espacioId?: number | null;
  alarmaId?: number | null;
}

export interface FiltroCapturas {
  placa?: string;
  motivo?: MotivoCaptura;
  desde?: string;
  hasta?: string;
  soloFallos?: boolean;
  limite?: number;
}

const dos = (n: number) => String(n).padStart(2, '0');

export class ServicioCaptura {
  constructor() {
    if (!existsSync(RAIZ_CAPTURAS)) mkdirSync(RAIZ_CAPTURAS, { recursive: true });
  }

  /**
   * Guarda una captura y devuelve la fila insertada.
   * Si la placa confirmada corresponde a un vehiculo conocido, enlaza
   * automaticamente con el vehiculo y con su ocupacion en curso.
   */
  guardar(datos: DatosCaptura) {
    const base64 = datos.imagen.includes(',')
      ? datos.imagen.split(',')[1]
      : datos.imagen;

    const buffer = Buffer.from(base64, 'base64');
    if (buffer.length === 0) throw new Error('La imagen recibida esta vacia');
    if (buffer.length > 8 * 1024 * 1024) throw new Error('La imagen supera los 8 MB');

    const placa = (datos.placaConfirmada ?? datos.placaDetectada ?? '').toUpperCase() || null;

    // --- Ruta en disco: una carpeta por dia ---
    const ahora = new Date();
    const dia = `${ahora.getFullYear()}-${dos(ahora.getMonth() + 1)}-${dos(ahora.getDate())}`;
    const hora = `${dos(ahora.getHours())}${dos(ahora.getMinutes())}${dos(ahora.getSeconds())}`;

    const carpeta = join(RAIZ_CAPTURAS, dia);
    if (!existsSync(carpeta)) mkdirSync(carpeta, { recursive: true });

    const nombre = `${hora}_${datos.motivo}${placa ? '_' + placa : ''}.jpg`;
    const rutaRelativa = `${dia}/${nombre}`;

    writeFileSync(join(carpeta, nombre), buffer);

    // --- Enlaces con el resto del sistema ---
    let vehiculoId: number | null = null;
    let ocupacionId: number | null = null;
    let espacioId = datos.espacioId ?? null;

    if (placa) {
      const v = db.prepare('SELECT id FROM vehiculo WHERE placa = ?').get(placa) as
        | { id: number }
        | undefined;

      if (v) {
        vehiculoId = v.id;
        const oc = db
          .prepare(
            `SELECT id, espacio_id FROM ocupacion
              WHERE vehiculo_id = ?
                AND estado IN ('ASIGNADO','OCUPADO','AUTORIZADO')`
          )
          .get(v.id) as { id: number; espacio_id: number } | undefined;

        if (oc) {
          ocupacionId = oc.id;
          espacioId = espacioId ?? oc.espacio_id;
        }
      }
    }

    const info = db
      .prepare(
        `INSERT INTO captura
           (motivo, ruta_archivo, bytes, ancho, alto,
            placa_detectada, metodo_lectura, confianza, placa_confirmada,
            vehiculo_id, ocupacion_id, alarma_id, espacio_id)
         VALUES
           (@motivo, @ruta, @bytes, @ancho, @alto,
            @detectada, @metodo, @confianza, @confirmada,
            @vehiculo, @ocupacion, @alarma, @espacio)`
      )
      .run({
        motivo: datos.motivo,
        ruta: rutaRelativa,
        bytes: buffer.length,
        ancho: datos.ancho ?? null,
        alto: datos.alto ?? null,
        detectada: datos.placaDetectada?.toUpperCase() ?? null,
        metodo: datos.metodoLectura ?? 'NINGUNO',
        confianza: datos.confianza ?? null,
        confirmada: datos.placaConfirmada?.toUpperCase() ?? null,
        vehiculo: vehiculoId,
        ocupacion: ocupacionId,
        alarma: datos.alarmaId ?? null,
        espacio: espacioId,
      });

    return this.porId(Number(info.lastInsertRowid));
  }

  porId(id: number) {
    return db.prepare('SELECT * FROM v_capturas WHERE id = ?').get(id);
  }

  /** Busqueda con filtros opcionales. Arma el WHERE dinamicamente. */
  buscar(filtro: FiltroCapturas = {}) {
    const condiciones: string[] = [];
    const params: Record<string, unknown> = {};

    if (filtro.placa) {
      condiciones.push('(placa_confirmada LIKE @placa OR placa_detectada LIKE @placa)');
      params.placa = `%${filtro.placa.toUpperCase()}%`;
    }
    if (filtro.motivo) {
      condiciones.push('motivo = @motivo');
      params.motivo = filtro.motivo;
    }
    if (filtro.desde) {
      condiciones.push('momento >= @desde');
      params.desde = filtro.desde;
    }
    if (filtro.hasta) {
      condiciones.push('momento <= @hasta');
      params.hasta = filtro.hasta;
    }
    if (filtro.soloFallos) {
      condiciones.push('acerto = 0');
    }

    const where = condiciones.length ? `WHERE ${condiciones.join(' AND ')}` : '';
    params.limite = Math.min(filtro.limite ?? 50, 200);

    return db
      .prepare(`SELECT * FROM v_capturas ${where} ORDER BY momento DESC, id DESC LIMIT @limite`)
      .all(params);
  }

  /** Historial fotografico completo de una placa. */
  historialDePlaca(placa: string) {
    return db
      .prepare(
        `SELECT * FROM v_capturas
          WHERE placa_confirmada = ?
          ORDER BY momento ASC`
      )
      .all(placa.toUpperCase());
  }

  /** Tasa de acierto del reconocimiento automatico. Para el informe. */
  precisionLectura() {
    return db.prepare('SELECT * FROM v_precision_lectura').all();
  }

  resumen() {
    return db
      .prepare(
        `SELECT motivo, COUNT(*) AS total, SUM(bytes) AS bytes_totales
           FROM captura GROUP BY motivo ORDER BY total DESC`
      )
      .all();
  }

  /** Devuelve el archivo fisico de una captura, o null si ya no existe. */
  leerArchivo(id: number): { buffer: Buffer; bytes: number } | null {
    const fila = db
      .prepare('SELECT ruta_archivo FROM captura WHERE id = ?')
      .get(id) as { ruta_archivo: string } | undefined;

    if (!fila) return null;

    const ruta = join(RAIZ_CAPTURAS, fila.ruta_archivo);
    if (!existsSync(ruta)) return null;

    return { buffer: readFileSync(ruta), bytes: statSync(ruta).size };
  }
}
