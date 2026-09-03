-- Seed the area catalog: Yerevan + its 12 administrative districts, the 10
-- provinces, and the cities that actually have salons.
--
-- Idempotent (ON CONFLICT DO NOTHING) so re-running is harmless and a later
-- migration can extend the list. Nothing here UPDATEs an existing row, so a
-- name corrected by staff in the console is never reverted by a redeploy.
--
-- `aliases` deliberately carries the names people TYPE rather than the official
-- ones: Soviet-era (leninakan, кировакан, камо), colloquial (ejmiatsin for
-- Vagharshapat, masiv for the Ajapnyak blocks), and transliterations. They are
-- never rendered — display always uses the official name.
--
-- Rows are ordered regions -> cities -> districts so every parent exists before
-- the child that references it.
INSERT INTO "areas" ("key", "parentKey", "kind", "name", "nameI18n", "aliases", "lat", "lng", "sortOrder", "active", "createdAt", "updatedAt")
VALUES
  ('aragatsotn', NULL, 'region', 'Aragatsotn', '{"hy": "Արագածոտն", "ru": "Арагацотн"}', ARRAY['aragatsotn', 'արագածոտն', 'арагацотн']::TEXT[], NULL, NULL, 10, true, NOW(), NOW()),
  ('ararat', NULL, 'region', 'Ararat', '{"hy": "Արարատ", "ru": "Арарат"}', ARRAY['ararat', 'արարատ', 'арарат']::TEXT[], NULL, NULL, 20, true, NOW(), NOW()),
  ('armavir', NULL, 'region', 'Armavir', '{"hy": "Արմավիր", "ru": "Армавир"}', ARRAY['armavir', 'արմավիր', 'армавир']::TEXT[], NULL, NULL, 30, true, NOW(), NOW()),
  ('gegharkunik', NULL, 'region', 'Gegharkunik', '{"hy": "Գեղարքունիք", "ru": "Гегаркуник"}', ARRAY['gegharkunik', 'գեղարքունիք', 'гегаркуник']::TEXT[], NULL, NULL, 40, true, NOW(), NOW()),
  ('kotayk', NULL, 'region', 'Kotayk', '{"hy": "Կոտայք", "ru": "Котайк"}', ARRAY['kotayk', 'կոտայք', 'котайк']::TEXT[], NULL, NULL, 50, true, NOW(), NOW()),
  ('lori', NULL, 'region', 'Lori', '{"hy": "Լոռի", "ru": "Лори"}', ARRAY['lori', 'լոռի', 'лори']::TEXT[], NULL, NULL, 60, true, NOW(), NOW()),
  ('shirak', NULL, 'region', 'Shirak', '{"hy": "Շիրակ", "ru": "Ширак"}', ARRAY['shirak', 'շիրակ', 'ширак']::TEXT[], NULL, NULL, 70, true, NOW(), NOW()),
  ('syunik', NULL, 'region', 'Syunik', '{"hy": "Սյունիք", "ru": "Сюник"}', ARRAY['syunik', 'սյունիք', 'сюник']::TEXT[], NULL, NULL, 80, true, NOW(), NOW()),
  ('tavush', NULL, 'region', 'Tavush', '{"hy": "Տավուշ", "ru": "Тавуш"}', ARRAY['tavush', 'տավուշ', 'тавуш']::TEXT[], NULL, NULL, 90, true, NOW(), NOW()),
  ('vayots-dzor', NULL, 'region', 'Vayots Dzor', '{"hy": "Վայոց Ձոր", "ru": "Вайоц Дзор"}', ARRAY['vayots dzor', 'վայոց ձոր', 'вайоц дзор']::TEXT[], NULL, NULL, 100, true, NOW(), NOW()),
  ('yerevan', NULL, 'city', 'Yerevan', '{"hy": "Երևան", "ru": "Ереван"}', ARRAY['erevan', 'ереван', 'երևան', 'yerevan', 'eriwan']::TEXT[], 40.1792, 44.4991, 110, true, NOW(), NOW()),
  ('gyumri', 'shirak', 'city', 'Gyumri', '{"hy": "Գյումրի", "ru": "Гюмри"}', ARRAY['gyumri', 'գյումրի', 'гюмри', 'leninakan', 'լենինական', 'ленинакан', 'kumayri']::TEXT[], 40.7894, 43.8475, 10, true, NOW(), NOW()),
  ('artik', 'shirak', 'city', 'Artik', '{"hy": "Արթիկ", "ru": "Артик"}', ARRAY['artik', 'արթիկ', 'артик']::TEXT[], 40.6156, 43.975, 20, true, NOW(), NOW()),
  ('maralik', 'shirak', 'city', 'Maralik', '{"hy": "Մարալիկ", "ru": "Маралик"}', ARRAY['maralik', 'մարալիկ', 'маралик']::TEXT[], 40.5747, 43.8711, 30, true, NOW(), NOW()),
  ('vanadzor', 'lori', 'city', 'Vanadzor', '{"hy": "Վանաձոր", "ru": "Ванадзор"}', ARRAY['vanadzor', 'վանաձոր', 'ванадзор', 'kirovakan', 'կիրովական', 'кировакан']::TEXT[], 40.8128, 44.4883, 10, true, NOW(), NOW()),
  ('alaverdi', 'lori', 'city', 'Alaverdi', '{"hy": "Ալավերդի", "ru": "Алаверди"}', ARRAY['alaverdi', 'ալավերդի', 'алаверди']::TEXT[], 41.0975, 44.6608, 20, true, NOW(), NOW()),
  ('spitak', 'lori', 'city', 'Spitak', '{"hy": "Սպիտակ", "ru": "Спитак"}', ARRAY['spitak', 'սպիտակ', 'спитак']::TEXT[], 40.8397, 44.2683, 30, true, NOW(), NOW()),
  ('stepanavan', 'lori', 'city', 'Stepanavan', '{"hy": "Ստեփանավան", "ru": "Степанаван"}', ARRAY['stepanavan', 'ստեփանավան', 'степанаван']::TEXT[], 41.0086, 44.3872, 40, true, NOW(), NOW()),
  ('abovyan', 'kotayk', 'city', 'Abovyan', '{"hy": "Աբովյան", "ru": "Абовян"}', ARRAY['abovyan', 'աբովյան', 'абовян']::TEXT[], 40.2739, 44.6256, 10, true, NOW(), NOW()),
  ('hrazdan', 'kotayk', 'city', 'Hrazdan', '{"hy": "Հրազդան", "ru": "Раздан"}', ARRAY['hrazdan', 'հրազդան', 'раздан', 'razdan']::TEXT[], 40.5006, 44.7664, 20, true, NOW(), NOW()),
  ('charentsavan', 'kotayk', 'city', 'Charentsavan', '{"hy": "Չարենցավան", "ru": "Чаренцаван"}', ARRAY['charentsavan', 'չարենցավան', 'чаренцаван']::TEXT[], 40.4092, 44.6414, 30, true, NOW(), NOW()),
  ('byureghavan', 'kotayk', 'city', 'Byureghavan', '{"hy": "Բյուրեղավան", "ru": "Бюрегаван"}', ARRAY['byureghavan', 'բյուրեղավան', 'бюрегаван']::TEXT[], 40.3406, 44.5722, 40, true, NOW(), NOW()),
  ('nor-hachn', 'kotayk', 'city', 'Nor Hachn', '{"hy": "Նոր Հաճն", "ru": "Нор Ачн"}', ARRAY['nor hachn', 'նոր հաճն', 'нор ачн']::TEXT[], 40.3061, 44.5836, 50, true, NOW(), NOW()),
  ('vagharshapat', 'armavir', 'city', 'Vagharshapat', '{"hy": "Վաղարշապատ", "ru": "Вагаршапат"}', ARRAY['vagharshapat', 'վաղարշապատ', 'вагаршапат', 'ejmiatsin', 'echmiadzin', 'էջմիածին', 'эчмиадзин']::TEXT[], 40.1667, 44.2931, 10, true, NOW(), NOW()),
  ('armavir-city', 'armavir', 'city', 'Armavir', '{"hy": "Արմավիր", "ru": "Армавир"}', ARRAY['armavir', 'արմավիր', 'армавир']::TEXT[], 40.1553, 44.0389, 20, true, NOW(), NOW()),
  ('metsamor', 'armavir', 'city', 'Metsamor', '{"hy": "Մեծամոր", "ru": "Мецамор"}', ARRAY['metsamor', 'մեծամոր', 'мецамор']::TEXT[], 40.1439, 44.1122, 30, true, NOW(), NOW()),
  ('artashat', 'ararat', 'city', 'Artashat', '{"hy": "Արտաշատ", "ru": "Арташат"}', ARRAY['artashat', 'արտաշատ', 'арташат']::TEXT[], 39.9531, 44.5439, 10, true, NOW(), NOW()),
  ('masis', 'ararat', 'city', 'Masis', '{"hy": "Մասիս", "ru": "Масис"}', ARRAY['masis', 'մասիս', 'масис']::TEXT[], 40.0664, 44.4247, 20, true, NOW(), NOW()),
  ('vedi', 'ararat', 'city', 'Vedi', '{"hy": "Վեդի", "ru": "Веди"}', ARRAY['vedi', 'վեդի', 'веди']::TEXT[], 39.9111, 44.7278, 30, true, NOW(), NOW()),
  ('ashtarak', 'aragatsotn', 'city', 'Ashtarak', '{"hy": "Աշտարակ", "ru": "Аштарак"}', ARRAY['ashtarak', 'աշտարակ', 'аштарак']::TEXT[], 40.2989, 44.3617, 10, true, NOW(), NOW()),
  ('aparan', 'aragatsotn', 'city', 'Aparan', '{"hy": "Ապարան", "ru": "Апаран"}', ARRAY['aparan', 'ապարան', 'апаран']::TEXT[], 40.5936, 44.3597, 20, true, NOW(), NOW()),
  ('talin', 'aragatsotn', 'city', 'Talin', '{"hy": "Թալին", "ru": "Талин"}', ARRAY['talin', 'թալին', 'талин']::TEXT[], 40.3925, 43.8747, 30, true, NOW(), NOW()),
  ('gavar', 'gegharkunik', 'city', 'Gavar', '{"hy": "Գավառ", "ru": "Гавар"}', ARRAY['gavar', 'գավառ', 'гавар', 'kamo', 'կամո', 'камо']::TEXT[], 40.3567, 45.1264, 10, true, NOW(), NOW()),
  ('sevan', 'gegharkunik', 'city', 'Sevan', '{"hy": "Սևան", "ru": "Севан"}', ARRAY['sevan', 'սևան', 'севан']::TEXT[], 40.5486, 44.9542, 20, true, NOW(), NOW()),
  ('martuni', 'gegharkunik', 'city', 'Martuni', '{"hy": "Մարտունի", "ru": "Мартуни"}', ARRAY['martuni', 'մարտունի', 'мартуни']::TEXT[], 40.1256, 45.305, 30, true, NOW(), NOW()),
  ('vardenis', 'gegharkunik', 'city', 'Vardenis', '{"hy": "Վարդենիս", "ru": "Варденис"}', ARRAY['vardenis', 'վարդենիս', 'варденис']::TEXT[], 40.1839, 45.7328, 40, true, NOW(), NOW()),
  ('chambarak', 'gegharkunik', 'city', 'Chambarak', '{"hy": "Ճամբարակ", "ru": "Чамбарак"}', ARRAY['chambarak', 'ճամբարակ', 'чамбарак']::TEXT[], 40.5983, 45.3792, 50, true, NOW(), NOW()),
  ('kapan', 'syunik', 'city', 'Kapan', '{"hy": "Կապան", "ru": "Капан"}', ARRAY['kapan', 'կապան', 'капан']::TEXT[], 39.2072, 46.4053, 10, true, NOW(), NOW()),
  ('goris', 'syunik', 'city', 'Goris', '{"hy": "Գորիս", "ru": "Горис"}', ARRAY['goris', 'գորիս', 'горис']::TEXT[], 39.5106, 46.3406, 20, true, NOW(), NOW()),
  ('sisian', 'syunik', 'city', 'Sisian', '{"hy": "Սիսիան", "ru": "Сисиан"}', ARRAY['sisian', 'սիսիան', 'сисиан']::TEXT[], 39.5197, 46.0322, 30, true, NOW(), NOW()),
  ('meghri', 'syunik', 'city', 'Meghri', '{"hy": "Մեղրի", "ru": "Мегри"}', ARRAY['meghri', 'մեղրի', 'мегри']::TEXT[], 38.9033, 46.2436, 40, true, NOW(), NOW()),
  ('ijevan', 'tavush', 'city', 'Ijevan', '{"hy": "Իջևան", "ru": "Иджеван"}', ARRAY['ijevan', 'իջևան', 'иджеван']::TEXT[], 40.8792, 45.1478, 10, true, NOW(), NOW()),
  ('dilijan', 'tavush', 'city', 'Dilijan', '{"hy": "Դիլիջան", "ru": "Дилижан"}', ARRAY['dilijan', 'դիլիջան', 'дилижан']::TEXT[], 40.7406, 44.8639, 20, true, NOW(), NOW()),
  ('berd', 'tavush', 'city', 'Berd', '{"hy": "Բերդ", "ru": "Берд"}', ARRAY['berd', 'բերդ', 'берд']::TEXT[], 40.8836, 45.3897, 30, true, NOW(), NOW()),
  ('noyemberyan', 'tavush', 'city', 'Noyemberyan', '{"hy": "Նոյեմբերյան", "ru": "Ноемберян"}', ARRAY['noyemberyan', 'նոյեմբերյան', 'ноемберян']::TEXT[], 41.1728, 44.995, 40, true, NOW(), NOW()),
  ('yeghegnadzor', 'vayots-dzor', 'city', 'Yeghegnadzor', '{"hy": "Եղեգնաձոր", "ru": "Ехегнадзор"}', ARRAY['yeghegnadzor', 'եղեգնաձոր', 'ехегнадзор']::TEXT[], 39.7614, 45.3331, 10, true, NOW(), NOW()),
  ('jermuk', 'vayots-dzor', 'city', 'Jermuk', '{"hy": "Ջերմուկ", "ru": "Джермук"}', ARRAY['jermuk', 'ջերմուկ', 'джермук']::TEXT[], 39.8414, 45.6717, 20, true, NOW(), NOW()),
  ('vayk', 'vayots-dzor', 'city', 'Vayk', '{"hy": "Վայք", "ru": "Вайк"}', ARRAY['vayk', 'վայք', 'вайк']::TEXT[], 39.7028, 45.47, 30, true, NOW(), NOW()),
  ('yerevan-ajapnyak', 'yerevan', 'district', 'Ajapnyak', '{"hy": "Աջափնյակ", "ru": "Аджапняк"}', ARRAY['ajapnyak', 'աջափնյակ', 'аджапняк', 'masiv', 'մասիվ', 'масив']::TEXT[], 40.2103, 44.452, 10, true, NOW(), NOW()),
  ('yerevan-arabkir', 'yerevan', 'district', 'Arabkir', '{"hy": "Արաբկիր", "ru": "Арабкир"}', ARRAY['arabkir', 'արաբկիր', 'арабкир', 'komitas', 'կոմիտաս']::TEXT[], 40.2003, 44.4948, 20, true, NOW(), NOW()),
  ('yerevan-avan', 'yerevan', 'district', 'Avan', '{"hy": "Ավան", "ru": "Аван"}', ARRAY['avan', 'ավան', 'аван']::TEXT[], 40.2178, 44.5643, 30, true, NOW(), NOW()),
  ('yerevan-davtashen', 'yerevan', 'district', 'Davtashen', '{"hy": "Դավթաշեն", "ru": "Давташен"}', ARRAY['davtashen', 'դավթաշեն', 'давташен']::TEXT[], 40.2283, 44.464, 40, true, NOW(), NOW()),
  ('yerevan-erebuni', 'yerevan', 'district', 'Erebuni', '{"hy": "Էրեբունի", "ru": "Эребуни"}', ARRAY['erebuni', 'էրեբունի', 'эребуни']::TEXT[], 40.1339, 44.5121, 50, true, NOW(), NOW()),
  ('yerevan-kanaker-zeytun', 'yerevan', 'district', 'Kanaker-Zeytun', '{"hy": "Քանաքեռ-Զեյթուն", "ru": "Канакер-Зейтун"}', ARRAY['kanaker', 'zeytun', 'քանաքեռ', 'զեյթուն', 'канакер', 'зейтун']::TEXT[], 40.2151, 44.5245, 60, true, NOW(), NOW()),
  ('yerevan-kentron', 'yerevan', 'district', 'Kentron', '{"hy": "Կենտրոն", "ru": "Кентрон"}', ARRAY['kentron', 'կենտրոն', 'кентрон', 'center', 'centre', 'центр']::TEXT[], 40.183, 44.5152, 70, true, NOW(), NOW()),
  ('yerevan-malatia-sebastia', 'yerevan', 'district', 'Malatia-Sebastia', '{"hy": "Մալաթիա-Սեբաստիա", "ru": "Малатия-Себастия"}', ARRAY['malatia', 'sebastia', 'մալաթիա', 'սեբաստիա', 'малатия', 'себастия', 'bangladesh', 'բանգլադեշ', 'бангладеш']::TEXT[], 40.1585, 44.4534, 80, true, NOW(), NOW()),
  ('yerevan-nor-nork', 'yerevan', 'district', 'Nor Nork', '{"hy": "Նոր Նորք", "ru": "Нор Норк"}', ARRAY['nor nork', 'նոր նորք', 'нор норк']::TEXT[], 40.2036, 44.562, 90, true, NOW(), NOW()),
  ('yerevan-nork-marash', 'yerevan', 'district', 'Nork-Marash', '{"hy": "Նորք-Մարաշ", "ru": "Норк-Мараш"}', ARRAY['nork', 'marash', 'նորք', 'մարաշ', 'норк', 'мараш']::TEXT[], 40.1795, 44.539, 100, true, NOW(), NOW()),
  ('yerevan-nubarashen', 'yerevan', 'district', 'Nubarashen', '{"hy": "Նուբարաշեն", "ru": "Нубарашен"}', ARRAY['nubarashen', 'նուբարաշեն', 'нубарашен']::TEXT[], 40.1155, 44.534, 110, true, NOW(), NOW()),
  ('yerevan-shengavit', 'yerevan', 'district', 'Shengavit', '{"hy": "Շենգավիթ", "ru": "Шенгавит"}', ARRAY['shengavit', 'շենգավիթ', 'шенгавит']::TEXT[], 40.1444, 44.478, 120, true, NOW(), NOW())
ON CONFLICT ("key") DO NOTHING;
