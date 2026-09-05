-- A professional has YEARS of experience; a listing has an experience
-- REQUIREMENT. They are not the same scale.
--
-- `professionals.experience` reused VacancyExperience ('any' | 'junior' |
-- 'experienced'), which is the vocabulary a SALON writes: "any experience
-- accepted", "suitable for beginners". Read back as a person's description of
-- themselves it is meaningless — nobody has "any" experience — and the Armenian
-- made it obvious on screen: «Ցանկացած փորձ» and «Սկսնակների համար» are things
-- an employer says about a role, offered here as answers about a person.
--
-- Years are what a professional actually knows about themselves, and they still
-- compare to the listing scale (a rule maps years onto junior/experienced), so
-- nothing about matching is lost.
--
-- SAFETY: the `professionals` table was created hours ago in migration
-- 20260905130000 and has never been deployed. On any database that runs these
-- in order the column is created and dropped without ever holding a row, so
-- this drop cannot lose data. Nothing outside this one table is touched.

-- AlterTable
ALTER TABLE "professionals" ADD COLUMN "experienceYears" INTEGER;

-- AlterTable
ALTER TABLE "professionals" DROP COLUMN "experience";
