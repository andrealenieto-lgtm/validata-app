-- CreateTable
CREATE TABLE "AbonoPendiente" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shop" TEXT NOT NULL,
    "cliente" TEXT NOT NULL DEFAULT '{}',
    "varianteId" TEXT NOT NULL,
    "varianteTitulo" TEXT NOT NULL,
    "cantidad" INTEGER NOT NULL,
    "monto" REAL NOT NULL,
    "saldo" REAL NOT NULL,
    "motivo" TEXT NOT NULL DEFAULT '',
    "estado" TEXT NOT NULL DEFAULT 'pendiente',
    "pedidoAbono" TEXT,
    "pedidoReal" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateIndex
CREATE INDEX "AbonoPendiente_shop_estado_idx" ON "AbonoPendiente"("shop", "estado");
