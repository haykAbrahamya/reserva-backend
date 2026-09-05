-- Open the `vacancies` product to self-serve signup.
--
-- Until now it was curated: platform staff granted it per partner from the
-- internal console. The migration that seeded the row said exactly what would
-- change that — "One UPDATE flips it to self-serve once a public vacancies
-- signup exists" — and that signup now exists at vacancies.reserva.am/signup.
--
-- This row IS the switch. SignupService validates the requested product against
-- the catalog (`assertSelfServe`) rather than against a hardcoded list,
-- precisely so that offering a product self-serve is a data change and not a
-- deploy. Without this line the new page would post `product: "vacancies"` and
-- be refused with UNKNOWN_PRODUCT.
--
-- Data-only and reversible. No schema change, nothing created, nothing removed,
-- and no existing grant is touched: partners who already hold vacancies keep
-- exactly the grant they have. Setting the flag back to false closes signups
-- again without affecting anyone already in.
UPDATE "products"
   SET "selfServe" = true,
       "updatedAt" = NOW()
 WHERE "key" = 'vacancies';
