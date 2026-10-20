/**
 * RUTAS DEL MODULO DE CAMARA
 *
 * Se montan en el servidor con:
 *   import { rutasCamara } from './camara/rutas.js';
 *   app.use('/api', rutasCamara());
 */

import { Router } from 'express';
import {
  ServicioCaptura,
  type MotivoCaptura,
  type MetodoLectura,
} from './servicio-captura.js';

const MOTIVOS: MotivoCaptura[] = ['REGISTRO', 'LLEGADA', 'ALARMA', 'SALIDA', 'MANUAL'];
const METODOS: MetodoLectura[] = ['QR', 'OCR', 'MANUAL', 'NINGUNO'];

/**
 * `alGuardar` se llama con cada captura nueva; el servidor lo usa para
 * dejarla anotada en la actividad del parqueo.
 */
export function rutasCamara(
  servicio = new ServicioCaptura(),
  alGuardar?: (captura: Record<string, unknown>) => void
): Router {
  const r = Router();

  /** Registra una captura nueva. El cuerpo trae la imagen en base64. */
  r.post('/captura', (req, res) => {
    try {
      const b = req.body ?? {};

      if (!b.imagen) {
        return res.status(400).json({ error: 'Falta la imagen' });
      }
      if (!MOTIVOS.includes(b.motivo)) {
        return res.status(400).json({ error: `Motivo invalido. Use: ${MOTIVOS.join(', ')}` });
      }
      if (b.metodoLectura && !METODOS.includes(b.metodoLectura)) {
        return res.status(400).json({ error: `Metodo invalido. Use: ${METODOS.join(', ')}` });
      }

      const captura = servicio.guardar({
        imagen: b.imagen,
        motivo: b.motivo,
        placaDetectada: b.placaDetectada ?? null,
        placaConfirmada: b.placaConfirmada ?? null,
        metodoLectura: b.metodoLectura ?? 'NINGUNO',
        confianza: b.confianza ?? null,
        ancho: b.ancho ?? null,
        alto: b.alto ?? null,
        espacioId: b.espacioId ?? null,
        alarmaId: b.alarmaId ?? null,
      });

      alGuardar?.(captura as Record<string, unknown>);
      res.status(201).json(captura);
    } catch (e) {
      res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
    }
  });

  /** Consulta con filtros: ?placa=&motivo=&desde=&hasta=&soloFallos=1&limite= */
  r.get('/capturas', (req, res) => {
    const q = req.query;
    res.json(
      servicio.buscar({
        placa: q.placa ? String(q.placa) : undefined,
        motivo: q.motivo ? (String(q.motivo) as MotivoCaptura) : undefined,
        desde: q.desde ? String(q.desde) : undefined,
        hasta: q.hasta ? String(q.hasta) : undefined,
        soloFallos: q.soloFallos === '1',
        limite: q.limite ? Number(q.limite) : undefined,
      })
    );
  });

  /** Historial fotografico de una placa, en orden cronologico. */
  r.get('/capturas/placa/:placa', (req, res) => {
    res.json(servicio.historialDePlaca(req.params.placa));
  });

  /** Tasa de acierto del reconocimiento automatico. */
  r.get('/capturas/precision', (_req, res) => {
    res.json({
      porMetodo: servicio.precisionLectura(),
      resumen: servicio.resumen(),
    });
  });

  /** Sirve el JPEG. Va al final para no chocar con las rutas anteriores. */
  r.get('/capturas/:id/imagen', (req, res) => {
    const archivo = servicio.leerArchivo(Number(req.params.id));
    if (!archivo) return res.status(404).json({ error: 'Captura no encontrada' });

    res.setHeader('Content-Type', 'image/jpeg');
    res.setHeader('Content-Length', archivo.bytes);
    res.setHeader('Cache-Control', 'public, max-age=86400');
    res.send(archivo.buffer);
  });

  r.get('/capturas/:id', (req, res) => {
    const captura = servicio.porId(Number(req.params.id));
    if (!captura) return res.status(404).json({ error: 'Captura no encontrada' });
    res.json(captura);
  });

  return r;
}
