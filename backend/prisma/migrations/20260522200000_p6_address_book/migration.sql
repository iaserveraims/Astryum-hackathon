-- P6.3: Address Book for wallet-to-wallet transfers
CREATE TABLE "address_book_entries" (
    "id"        TEXT NOT NULL,
    "userId"    TEXT NOT NULL,
    "label"     TEXT NOT NULL,
    "address"   TEXT NOT NULL,
    "chainId"   INTEGER,
    "ens"       TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "address_book_entries_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "address_book_entries_userId_address_chainId_key"
    ON "address_book_entries"("userId", "address", "chainId");

CREATE INDEX "address_book_entries_userId_idx"
    ON "address_book_entries"("userId");
