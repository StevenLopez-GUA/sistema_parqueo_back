/**
 * SERVIDOR
 * Express para la API + WebSocket para empujar el estado del parqueo
 * a la interfaz sin que el navegador tenga que estar preguntando.
 */

import './entorno.js'; // primero: carga backend/.env
import express from 'express';
import cors from 'cors';
import { createServer } from 'node:http';
import { WebSocketServer, WebSocket } from 'ws';

import { reiniciarParqueo } from './db/db.js';
import { ServicioParqueo } from './parqueo/servicio.js';
import { Interprete } from './lenguaje/interprete.js';
import { crearTransporte, SimuladorArduino } from './hardware/transporte.js';
import { rutasCamara } from './camara/rutas.js';
import { rutasArduino } from './hardware/rutas-arduino.js';
import { TIPOS_VEHICULO } from './lenguaje/lexer.js';
import { TransporteHttp } from './hardware/transporte-http.js';

// 8080: el puerto que usa el firmware de la maqueta (puertoAPI).
const PUERTO = Number(process.env.PUERTO ?? 8080);

const hardware = crearTransporte();
const servicio = new ServicioParqueo(hardware);
const interprete = new Interprete(servicio);

// ---------------------------------------------------------------------
// Tramas que llegan desde la maqueta
// ---------------------------------------------------------------------

hardware.alRecibir((trama) => {
  switch (trama.tipo) {
    case 'SENSOR':
      servicio.alCambiarSensor(trama.indice, trama.ocupado);
      break;
    case 'BOTON':
      servicio.alPresionarBoton();
      break;
    case 'MOVIMIENTO':
      servicio.alDetectarMovimiento(trama.activo);
      break;
    case 'LISTO':
      console.log('[hardware] maqueta lista, sincronizando LEDs');
      servicio.sincronizarTodosLosLeds();
      break;
    case 'DESCONOCIDA':
      if (trama.texto) console.warn('[hardware] trama no reconocida:', trama.texto);
      break;
  }
});

await hardware.conectar();

// ---------------------------------------------------------------------
// API
// ---------------------------------------------------------------------

const app = express();
app.use(cors());
// Las capturas viajan en base64 dentro del JSON, por eso el limite alto.
app.use(express.json({ limit: '12mb' }));

const MOTIVO_CAPTURA: Record<string, string> = {
  REGISTRO: 'entrada',
  LLEGADA: 'llegada',
  SALIDA: 'salida',
  ALARMA: 'evidencia de alarma',
  MANUAL: 'manual',
};

// Modulo de camara: /api/captura, /api/capturas, /api/capturas/precision
// Cada captura guardada queda en la actividad del parqueo.
app.use(
  '/api',
  rutasCamara(undefined, (c) => {
    const placa = (c.placa_confirmada as string | null) ?? 'sin placa';
    const motivo = MOTIVO_CAPTURA[String(c.motivo)] ?? String(c.motivo).toLowerCase();
    servicio.registrarEvento(`Captura #${c.id}: ${placa} (${motivo})`, 'info');
    difundir();
  })
);

// Maqueta por WiFi: el Arduino R4 postea en /api/v1/sensores
if (hardware instanceof TransporteHttp) {
  app.use('/api', rutasArduino(hardware));
}

/** Lo que recibe la interfaz: por HTTP al cargar y por WebSocket en cada cambio. */
function estadoCompleto() {
  return {
    espacios: servicio.estado(),
    disponibilidad: servicio.disponibilidad(),
    eventos: servicio.ultimosEventos(),
    modo: hardware.modo,
    seleccionado: servicio.espacioSeleccionado,
    reservas: servicio.reservas(),
  };
}

app.get('/api/estado', (_req, res) => {
  res.json(estadoCompleto());
});

/** Corre el intérprete sobre el código que escribió el operador. */
app.post('/api/ejecutar', (req, res) => {
  const codigo = String(req.body?.codigo ?? '');
  const resultado = interprete.ejecutar(codigo);
  difundir();
  res.json(resultado);
});

app.get('/api/bitacora', (_req, res) => {
  res.json(servicio.bitacora(Number(process.env.LIMITE_BITACORA ?? 60)));
});

/** Marca el espacio sobre el que actúa el botón físico de autorización. */
app.post('/api/seleccionar', (req, res) => {
  const id = req.body?.espacio_id;
  servicio.espacioSeleccionado = id === null || id === undefined ? null : Number(id);
  difundir();
  res.json({ seleccionado: servicio.espacioSeleccionado });
});

// ---------------------------------------------------------------------
// Entrada desde la camara: registrar el vehiculo y asignarlo al espacio
// que eligio el operador. Si no hay lugar, alarma de parqueo lleno.
// ---------------------------------------------------------------------

const PLACA = /^[A-Z][0-9]{3}[A-Z]{3}$/;

/** Espacios libres compatibles con una entrada; el primero es el recomendado. */
app.get('/api/espacios/compatibles', (req, res) => {
  const tipo = String(req.query.tipo ?? '');
  const placa = String(req.query.placa ?? '').toUpperCase();
  if (!TIPOS_VEHICULO.has(tipo)) return res.status(400).json({ error: 'Tipo de vehiculo invalido' });
  res.json({
    espacios: servicio.espaciosCompatibles(tipo, placa),
    tipoRegistrado: servicio.vehiculoPorPlaca(placa)?.tipo ?? null,
  });
});

app.post('/api/entrada', (req, res) => {
  const placa = String(req.body?.placa ?? '').toUpperCase();
  const tipo = String(req.body?.tipo ?? '');
  const espacioId = req.body?.espacio_id == null ? null : Number(req.body.espacio_id);

  if (!PLACA.test(placa)) return res.status(400).json({ error: 'La placa debe tener el formato P123ABC' });
  if (!TIPOS_VEHICULO.has(tipo)) return res.status(400).json({ error: 'Tipo de vehiculo invalido' });

  const viva = servicio.ocupacionViva(placa);
  if (viva) {
    return res.status(409).json({ error: `La placa ${placa} ya esta en el parqueo (espacio ${viva.espacio})` });
  }

  try {
    servicio.registrar(tipo, placa);

    if (espacioId === null) {
      if (servicio.espaciosCompatibles(tipo, placa).length > 0) {
        return res.status(400).json({ error: 'Falta elegir el espacio' });
      }
      const mensaje = `PARQUEO LLENO: no hay espacio libre para ${placa} (${tipo})`;
      servicio.registrarEvento(mensaje, 'alarma');
      servicio.anotarBitacora({ origen: 'SISTEMA', resultado: 'OK', mensaje });
      difundir();
      return res.status(409).json({ lleno: true, error: mensaje });
    }

    const mensaje = servicio.asignarEn(placa, espacioId);
    difundir();
    res.json({ ok: true, mensaje });
  } catch (e) {
    res.status(409).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

// ---------------------------------------------------------------------
// Espacios privados: que placa puede usar cada uno (una a la vez)
// ---------------------------------------------------------------------

app.post('/api/reservas', (req, res) => {
  const placa = String(req.body?.placa ?? '').toUpperCase();
  const espacioId = Number(req.body?.espacio_id);
  if (!PLACA.test(placa)) return res.status(400).json({ error: 'La placa debe tener el formato P123ABC' });
  try {
    res.json({ ok: true, mensaje: servicio.reservar(espacioId, placa) });
  } catch (e) {
    res.status(409).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

app.delete('/api/reservas/:espacioId', (req, res) => {
  try {
    res.json({ ok: true, mensaje: servicio.quitarReserva(Number(req.params.espacioId)) });
  } catch (e) {
    res.status(409).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

/** Apaga la alarma sin placa de un espacio (vehiculo no registrado). */
app.post('/api/alarmas/apagar', (req, res) => {
  try {
    res.json({ ok: true, mensaje: servicio.apagarAlarmaDeEspacio(Number(req.body?.espacio_id)) });
  } catch (e) {
    res.status(409).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

app.post('/api/reiniciar', (_req, res) => {
  reiniciarParqueo();
  servicio.sincronizarTodosLosLeds();
  servicio.registrarEvento('Parqueo reiniciado', 'info');
  difundir();
  res.json({ ok: true });
});

// --- Controles del simulador (no existen con hardware real) ---

app.post('/api/simulador/sensor', (req, res) => {
  if (!(hardware instanceof SimuladorArduino)) {
    return res.status(409).json({ error: 'El backend esta conectado a hardware real' });
  }
  hardware.moverVehiculo(Number(req.body?.indice), Boolean(req.body?.presente));
  difundir();
  res.json({ ok: true });
});

app.post('/api/simulador/boton', (_req, res) => {
  if (!(hardware instanceof SimuladorArduino)) {
    return res.status(409).json({ error: 'El backend esta conectado a hardware real' });
  }
  hardware.presionarBoton();
  difundir();
  res.json({ ok: true });
});

// ---------------------------------------------------------------------
// WebSocket
// ---------------------------------------------------------------------

const servidor = createServer(app);
const wss = new WebSocketServer({ server: servidor });

function difundir(): void {
  const carga = JSON.stringify(estadoCompleto());
  wss.clients.forEach((c) => {
    if (c.readyState === WebSocket.OPEN) c.send(carga);
  });
}

// Cualquier cambio de estado en el servicio se empuja al navegador.
servicio.alCambiar(difundir);

wss.on('connection', (ws) => {
  ws.send(JSON.stringify(estadoCompleto()));
});

servidor.listen(PUERTO, () => {
  console.log(`[servidor] escuchando en http://localhost:${PUERTO}`);
  console.log(`[servidor] modo hardware: ${hardware.modo}`);
  servicio.sincronizarTodosLosLeds();
});
