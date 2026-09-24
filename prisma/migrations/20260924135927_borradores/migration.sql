-- CreateTable
CREATE TABLE "Borrador" (
    "shop" TEXT NOT NULL,
    "telefono" TEXT NOT NULL,
    "nombre" TEXT NOT NULL DEFAULT '',
    "producto" TEXT NOT NULL DEFAULT '',
    "ruta" TEXT NOT NULL DEFAULT '',
    "actualizado" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completado" BOOLEAN NOT NULL DEFAULT false,
    "recordado" BOOLEAN NOT NULL DEFAULT false,

    PRIMARY KEY ("shop", "telefono")
);

-- CreateIndex
CREATE INDEX "Borrador_completado_recordado_actualizado_idx" ON "Borrador"("completado", "recordado", "actualizado");
