# Sistema Inteligente de Parqueo — Backend

Proyecto Integrador — Universidad Mariano Gálvez de Guatemala
Ingeniería en Sistemas, Sexto Semestre, Sección A

Backend en Node + TypeScript. Interpreta los comandos del lenguaje formal del parqueo,
guarda todo en la base de datos y se comunica con la maqueta (Arduino) por serial o WiFi.

```
  Frontend (React)
        │  HTTP + WebSocket
        ▼
  Backend (este repo)
    ├── Intérprete: léxico → sintáctico → semántico → acciones
    ├── Servicio: autómata de estados de cada espacio
    ├── Cámara: capturas y lectura de placas
    ├── Base de datos: SQLite (y su versión para SQL Server)
    └── Transporte ── simulador | serial (Arduino Mega) | http (Arduino R4 WiFi)
```

---

## Instalación

Requiere Node.js 20 o superior.

```bash
npm install
cp .env.example .env     # opcional: sin .env arranca en modo simulador
npm run dev              # http://localhost:8080
```

La base de datos `parqueo.db` se crea sola la primera vez, ejecutando
`src/db/esquema.sql`. Para cargar los 5 espacios de la maqueta física:

```bash
npm run bd:maqueta
```

### Modos de hardware (`.env`)

| `MODO_HARDWARE` | Uso |
|---|---|
| `simulador` | Sin maqueta. Los sensores se simulan desde la interfaz. |
| `serial` | Arduino Mega por USB. Configurar `PUERTO_SERIAL` y `BAUDIOS`. |
| `http` | Arduino R4 WiFi. El Arduino postea a `http://<ip-de-la-laptop>:8080/api/v1/sensores`. |

---

## Scripts

| Comando | Qué hace |
|---|---|
| `npm run dev` | Arranca el servidor y lo reinicia al guardar cambios |
| `npm start` | Arranca el servidor |
| `npm run build` | Compila TypeScript |
| `npm run bd:reset` | Borra `parqueo.db` (se recrea al arrancar) |
| `npm run bd:maqueta` | Carga la semilla de la maqueta de 5 espacios |
| `npm run bd:sqlserver` | Exporta los datos de SQLite a `src/db/sqlserver/datos.sql` |
| `npm run prueba` | Prueba del flujo completo del intérprete, sin navegador |
| `npm run prueba:camara` | Prueba del módulo de cámara |
| `npm run prueba:http` | Prueba del transporte HTTP con la maqueta |

---

## Base de datos

La app usa **SQLite** (`better-sqlite3`): toda la base vive en el archivo `parqueo.db`
y no necesita servidor. Para verla, usa la extensión **SQLite Viewer** de VS Code o
**DB Browser for SQLite**.

| Archivo | Contenido |
|---|---|
| `src/db/esquema.sql` | Tablas, índices, vistas y catálogos |
| `src/db/migracion_camara.sql` | Tabla `captura` y vistas de la cámara |
| `src/db/semilla_maqueta.sql` | Los 5 espacios de la maqueta física |

### Versión SQL Server

En `src/db/sqlserver/` está la misma base en T-SQL, para entregar o revisar en SQL Server:

| Archivo | Contenido |
|---|---|
| `esquema.sql` | Crea la base `ParqueoUMG` con tablas, índices filtrados y vistas |
| `datos.sql` | Los datos actuales de SQLite (se regenera con `npm run bd:sqlserver`) |

Se ejecutan en ese orden. Con SQL Server en Docker:

```bash
npm run bd:sqlserver
docker cp src/db/sqlserver/. <contenedor>:/tmp/sql/
docker exec <contenedor> /opt/mssql-tools18/bin/sqlcmd -S localhost -U sa -P '<clave>' -C -i /tmp/sql/esquema.sql
docker exec <contenedor> /opt/mssql-tools18/bin/sqlcmd -S localhost -U sa -P '<clave>' -C -i /tmp/sql/datos.sql
```

También se pueden abrir y ejecutar desde SSMS, Azure Data Studio o la extensión
SQL Server (mssql) de VS Code.

### Tablas

| Tabla | Para qué |
|---|---|
| `tipo_vehiculo`, `tipo_espacio` | Catálogos |
| `compatibilidad` | Qué vehículo cabe en qué espacio, con prioridad |
| `espacio` | Espacios de la maqueta con su estado actual |
| `vehiculo` | Placas registradas (formato `P123ABC`) |
| `reserva` | Espacios reservados para una placa |
| `ocupacion` | Ciclo completo de cada entrada y salida |
| `alarma` | Salidas no autorizadas y otras alarmas |
| `bitacora` | Todos los comandos y errores del intérprete |
| `captura` | Fotos de la cámara y lectura de placas |

Las reglas de negocio se garantizan con índices únicos filtrados: un espacio no puede
tener dos ocupaciones vivas, un vehículo no puede estar en dos espacios y un espacio
no puede tener dos alarmas activas.

---

## API

| Método | Ruta | Qué hace |
|---|---|---|
| GET | `/api/estado` | Estado completo del parqueo |
| POST | `/api/ejecutar` | Ejecuta comandos del lenguaje formal |
| GET | `/api/bitacora` | Historial de comandos |
| POST | `/api/seleccionar` | Selecciona un espacio |
| GET | `/api/espacios/compatibles` | Espacios compatibles con un tipo de vehículo |
| POST | `/api/entrada` | Registra la entrada de un vehículo |
| POST | `/api/reservas` | Crea una reserva |
| DELETE | `/api/reservas/:espacioId` | Quita una reserva |
| POST | `/api/alarmas/apagar` | Apaga una alarma |
| POST | `/api/reiniciar` | Deja el parqueo en cero (conserva catálogos y capturas) |
| POST | `/api/simulador/sensor` | Simula un sensor (modo simulador) |
| POST | `/api/simulador/boton` | Simula el botón de autorización |
| POST | `/api/captura` | Guarda una captura de la cámara |
| GET | `/api/capturas` | Lista de capturas |
| GET | `/api/capturas/placa/:placa` | Capturas de una placa |
| GET | `/api/capturas/precision` | Tasa de acierto de la lectura de placas |
| GET | `/api/capturas/:id` | Datos de una captura |
| GET | `/api/capturas/:id/imagen` | Imagen de una captura |
| POST | `/api/v1/sensores` | El Arduino R4 reporta sus sensores (modo http) |
| GET | `/api/v1/maqueta` | Estado de la maqueta (modo http) |
| POST | `/api/v1/paso` | Paso de la maqueta (modo http) |

Además hay un WebSocket que manda el estado completo en cada cambio.

---

## El lenguaje formal

```
REGISTRAR(compacto,P123ABC);
ASIGNAR(P123ABC);
LLEGADA(P123ABC);
AUTORIZAR_SALIDA(P123ABC);
SALIDA(P123ABC);
APAGAR_ALARMA(P123ABC);
CONSULTAR();
```

Tipos de vehículo: `compacto`, `grande`, `moto`, `carga`. Placa: `[A-Z][0-9]{3}[A-Z]{3}`.
Los comentarios empiezan con `#`. La gramática es LL(1) y el parser es descendente
recursivo escrito a mano.

---

## Estructura

```
├── prueba.ts, prueba-camara.ts, prueba-http.ts   pruebas sin navegador
└── src/
    ├── servidor.ts              Express + WebSocket
    ├── entorno.ts               carga el .env
    ├── db/
    │   ├── db.ts                conexión SQLite
    │   ├── esquema.sql          tablas, vistas, catálogos
    │   ├── migracion_camara.sql módulo de cámara
    │   ├── semilla_maqueta.sql  maqueta de 5 espacios
    │   ├── cargar_maqueta.cjs   npm run bd:maqueta
    │   ├── exportar_sqlserver.cjs  npm run bd:sqlserver
    │   └── sqlserver/           versión T-SQL de la base
    ├── lenguaje/                lexer, parser, semántico, intérprete
    ├── parqueo/servicio.ts      autómata de estados y alarmas
    ├── camara/                  capturas y lectura de placas
    └── hardware/                protocolo, serial, simulador y HTTP
```
