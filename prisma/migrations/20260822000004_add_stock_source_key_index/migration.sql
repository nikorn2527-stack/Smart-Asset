-- Speed up source-key replay lookup while preserving legacy duplicate rows.
-- A unique constraint is intentionally deferred until duplicate legacy keys are audited.
CREATE INDEX "StockTransaction_sourceKey_idx" ON "StockTransaction"("sourceKey");

