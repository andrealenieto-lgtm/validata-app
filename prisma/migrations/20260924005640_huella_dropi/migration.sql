-- CreateTable
CREATE TABLE "HuellaDropi" (
    "shop" TEXT NOT NULL,
    "telefono" TEXT NOT NULL,
    "entregas" INTEGER NOT NULL,
    "devoluciones" INTEGER NOT NULL,
    "capturada" DATETIME NOT NULL,

    PRIMARY KEY ("shop", "telefono")
);
