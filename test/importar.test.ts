import { test } from "node:test";
import assert from "node:assert/strict";

import { ErrorImportacion, importarHistorial, parsearCsv, parsearFecha } from "../app/lib/importar.ts";

test("CSV con punto y coma, comillas, BOM y saltos de línea dentro de comillas", () => {
  const csv = '﻿ID;NOMBRE;DIRECCIÓN\r\n1;"Ana; Pérez";"Cl 13 # 20-35\nApto 2"\r\n2;"Luis ""el flaco""";Cra 7\r\n';
  assert.deepEqual(parsearCsv(csv), [
    ["ID", "NOMBRE", "DIRECCIÓN"],
    ["1", "Ana; Pérez", "Cl 13 # 20-35\nApto 2"],
    ["2", 'Luis "el flaco"', "Cra 7"],
  ]);
});

test("fechas en formatos de Colombia", () => {
  assert.equal(parsearFecha("2026-07-11")?.toISOString().slice(0, 10), "2026-07-11");
  assert.equal(parsearFecha("11/07/2026")?.toISOString().slice(0, 10), "2026-07-11");
  assert.equal(parsearFecha("11-07-2026 10:22")?.toISOString().slice(0, 10), "2026-07-11");
  assert.equal(parsearFecha("31/02/2026"), null);
  assert.equal(parsearFecha(""), null);
});

test("export tipo Dropi: detecta columnas con tildes y mayúsculas", () => {
  const csv = [
    "ID,FECHA DE CREACIÓN,NOMBRE CLIENTE,TELÉFONO,ESTATUS,TRANSPORTADORA",
    "1001,11/07/2026,Ana,300 111 1111,ENTREGADO,SERVIENTREGA",
    "1002,12/07/2026,Ana,+57 300-111-1111,DEVOLUCION,SERVIENTREGA",
    "1003,13/07/2026,Luis,3002222222,RECHAZADO,COORDINADORA",
    "1004,14/07/2026,Sin tel,,ENTREGADO,COORDINADORA",
    "1005,15/07/2026,Pepe,3003333333,EN REPARTO,COORDINADORA",
  ].join("\n");
  const r = importarHistorial(csv);
  assert.deepEqual(r.columnas, {
    telefono: "TELÉFONO",
    estado: "ESTATUS",
    fecha: "FECHA DE CREACIÓN",
    referencia: "ID",
  });
  assert.equal(r.totalFilas, 5);
  assert.equal(r.filas.length, 4);
  assert.equal(r.sinTelefono, 1);
  assert.deepEqual([r.entregados, r.devueltos, r.otros], [1, 2, 1]);
  assert.equal(r.filas[1].telefono, "+573001111111");
  assert.equal(r.filas[1].referencia, "1002");
});

test("sin columna de número de orden: referencia estable para no duplicar al reimportar", () => {
  const csv = "celular;estado\n3001111111;ENTREGADO\n3001111111;DEVOLUCION\n";
  const a = importarHistorial(csv);
  const b = importarHistorial(csv);
  assert.equal(a.columnas.referencia, null);
  assert.deepEqual(
    a.filas.map((f) => f.referencia),
    b.filas.map((f) => f.referencia),
  );
  assert.notEqual(a.filas[0].referencia, a.filas[1].referencia);
});

test("errores claros si falta teléfono o estado", () => {
  assert.throws(() => importarHistorial("nombre,estado\nAna,ENTREGADO"), ErrorImportacion);
  assert.throws(() => importarHistorial("nombre,telefono\nAna,3001111111"), /estado/);
  assert.throws(() => importarHistorial(""), /vacío/);
});
