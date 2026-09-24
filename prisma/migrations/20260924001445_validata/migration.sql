-- CreateTable
CREATE TABLE "Tienda" (
    "shop" TEXT NOT NULL PRIMARY KEY,
    "validacion" TEXT NOT NULL DEFAULT '{}',
    "modoHuella" TEXT NOT NULL DEFAULT 'detalle_verificado',
    "formulario" TEXT NOT NULL DEFAULT '{}',
    "configuracion" TEXT NOT NULL DEFAULT '{}',
    "mensajeria" TEXT NOT NULL DEFAULT '{}',
    "plan" TEXT NOT NULL DEFAULT 'gratis',
    "intervalo" TEXT NOT NULL DEFAULT 'mensual',
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "HistorialPedido" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "shop" TEXT NOT NULL,
    "telefono" TEXT NOT NULL,
    "referencia" TEXT NOT NULL,
    "estado" TEXT NOT NULL,
    "fecha" DATETIME,
    "origen" TEXT NOT NULL DEFAULT 'csv'
);

-- CreateTable
CREATE TABLE "Evento" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "shop" TEXT NOT NULL,
    "tipo" TEXT NOT NULL,
    "datos" TEXT NOT NULL DEFAULT '{}',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "Otp" (
    "shop" TEXT NOT NULL,
    "telefono" TEXT NOT NULL,
    "hash" TEXT NOT NULL,
    "creado" DATETIME NOT NULL,
    "intentos" INTEGER NOT NULL DEFAULT 0,

    PRIMARY KEY ("shop", "telefono")
);

-- CreateIndex
CREATE INDEX "HistorialPedido_shop_telefono_idx" ON "HistorialPedido"("shop", "telefono");

-- CreateIndex
CREATE UNIQUE INDEX "HistorialPedido_shop_origen_referencia_key" ON "HistorialPedido"("shop", "origen", "referencia");

-- CreateIndex
CREATE INDEX "Evento_shop_createdAt_idx" ON "Evento"("shop", "createdAt");
