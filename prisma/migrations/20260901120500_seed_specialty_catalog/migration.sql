-- Seed the platform vocabulary: specialty groups + specialties, plus the
-- `vacancies` product row.
--
-- Idempotent (ON CONFLICT DO NOTHING) so re-running is harmless and a later
-- migration can extend the list without rewriting this one. Nothing here
-- UPDATEs an existing row, so a translation corrected by staff in the console
-- is never silently reverted by a redeploy.

-- Specialty groups -----------------------------------------------------------
INSERT INTO "specialty_groups" ("key", "name", "nameI18n", "sortOrder", "active", "createdAt", "updatedAt")
VALUES
  ('hair', 'Hair', '{"hy": "Մազեր", "ru": "Волосы"}', 10, true, NOW(), NOW()),
  ('nails', 'Nails', '{"hy": "Եղունգներ", "ru": "Ногти"}', 20, true, NOW(), NOW()),
  ('brows-lashes', 'Brows & lashes', '{"hy": "Հոնքեր և թարթիչներ", "ru": "Брови и ресницы"}', 30, true, NOW(), NOW()),
  ('makeup', 'Makeup', '{"hy": "Դիմահարդարում", "ru": "Макияж"}', 40, true, NOW(), NOW()),
  ('skin', 'Skin & aesthetics', '{"hy": "Մաշկ և կոսմետոլոգիա", "ru": "Кожа и косметология"}', 50, true, NOW(), NOW()),
  ('body', 'Body & wellness', '{"hy": "Մարմին և առողջություն", "ru": "Тело и велнес"}', 60, true, NOW(), NOW()),
  ('medical', 'Medical & clinical', '{"hy": "Բժշկական", "ru": "Медицина"}', 70, true, NOW(), NOW()),
  ('tattoo', 'Tattoo & piercing', '{"hy": "Դաջվածք և ծակոց", "ru": "Тату и пирсинг"}', 80, true, NOW(), NOW()),
  ('support', 'Support & operations', '{"hy": "Աջակցող անձնակազմ", "ru": "Персонал и поддержка"}', 90, true, NOW(), NOW()),
  ('other', 'Other', '{"hy": "Այլ", "ru": "Другое"}', 100, true, NOW(), NOW())
ON CONFLICT ("key") DO NOTHING;

-- Specialties ----------------------------------------------------------------
-- `name` is the field of work ("Hair styling"); `roleName` is the practitioner
-- ("Hair stylist"). Carrying both lets one row label a service category, a
-- specialist's title and a vacancy without the vocabulary being duplicated.
INSERT INTO "specialties" ("key", "groupKey", "name", "nameI18n", "roleName", "roleNameI18n", "aliases", "sortOrder", "active", "createdAt", "updatedAt")
VALUES
  ('barbering', 'hair', 'Barbering', '{"hy": "Բարբերություն", "ru": "Барберинг"}', 'Barber', '{"hy": "Բարբեր", "ru": "Барбер"}', ARRAY['barber', 'барбер', 'բարբեր', 'мужской парикмахер', 'barbershop']::TEXT[], 10, true, NOW(), NOW()),
  ('hair-styling', 'hair', 'Hair styling', '{"hy": "Վարսահարդարում", "ru": "Парикмахерское дело"}', 'Hair stylist', '{"hy": "Վարսահարդար", "ru": "Парикмахер"}', ARRAY['hairdresser', 'hair stylist', 'парикмахер', 'стилист по волосам', 'վարսահարդար', 'վարսավիրույթ', 'coiffeur']::TEXT[], 20, true, NOW(), NOW()),
  ('hair-coloring', 'hair', 'Hair coloring', '{"hy": "Մազերի ներկում", "ru": "Окрашивание волос"}', 'Colorist', '{"hy": "Կոլորիստ", "ru": "Колорист"}', ARRAY['colorist', 'колорист', 'окрашивание', 'Կոլորիստ', 'balayage', 'блонд']::TEXT[], 30, true, NOW(), NOW()),
  ('hair-treatment', 'hair', 'Hair care & treatment', '{"hy": "Մազերի խնամք", "ru": "Уход за волосами"}', 'Hair care specialist', '{"hy": "Մազերի խնամքի մասնագետ", "ru": "Специалист по уходу за волосами"}', ARRAY['keratin', 'кератин', 'ботокс волос', 'Մազերի խնամք']::TEXT[], 40, true, NOW(), NOW()),
  ('hair-extensions', 'hair', 'Hair extensions', '{"hy": "Մազերի երկարացում", "ru": "Наращивание волос"}', 'Extension specialist', '{"hy": "Մազերի երկարացման մասնագետ", "ru": "Мастер по наращиванию волос"}', ARRAY['наращивание волос', 'hair extension']::TEXT[], 50, true, NOW(), NOW()),
  ('wigs', 'hair', 'Wigs & hairpieces', '{"hy": "Կեղծամներ", "ru": "Парики и накладки"}', 'Wig specialist', '{"hy": "Կեղծամագործ", "ru": "Мастер по парикам"}', ARRAY['парик', 'wig', 'կեղծամ']::TEXT[], 60, true, NOW(), NOW()),
  ('manicure', 'nails', 'Manicure', '{"hy": "Մատնահարդարում", "ru": "Маникюр"}', 'Manicurist', '{"hy": "Մատնահարդար", "ru": "Мастер маникюра"}', ARRAY['nail master', 'мастер маникюра', 'маникюрша', 'Մատնահարդար', 'nail']::TEXT[], 10, true, NOW(), NOW()),
  ('pedicure', 'nails', 'Pedicure', '{"hy": "Ոտնահարդարում", "ru": "Педикюр"}', 'Pedicurist', '{"hy": "Ոտնահարդար", "ru": "Мастер педикюра"}', ARRAY['педикюр', 'pedicure', 'Ոտնահարդար']::TEXT[], 20, true, NOW(), NOW()),
  ('nail-extensions', 'nails', 'Nail extensions', '{"hy": "Եղունգների երկարացում", "ru": "Наращивание ногтей"}', 'Nail technician', '{"hy": "Եղունգների մասնագետ", "ru": "Мастер по наращиванию ногтей"}', ARRAY['наращивание ногтей', 'гель', 'акрил', 'nail tech']::TEXT[], 30, true, NOW(), NOW()),
  ('nail-art', 'nails', 'Nail art', '{"hy": "Եղունգների դիզայն", "ru": "Дизайн ногтей"}', 'Nail artist', '{"hy": "Նեյլ-արտիստ", "ru": "Нейл-арт мастер"}', ARRAY['nail art', 'дизайн ногтей', 'нейл арт']::TEXT[], 40, true, NOW(), NOW()),
  ('brow-design', 'brows-lashes', 'Brow design', '{"hy": "Հոնքերի ձևավորում", "ru": "Оформление бровей"}', 'Brow artist', '{"hy": "Հոնքերի մասնագետ", "ru": "Бровист"}', ARRAY['бровист', 'brow', 'հոնք', 'оформление бровей']::TEXT[], 10, true, NOW(), NOW()),
  ('lash-extensions', 'brows-lashes', 'Lash extensions', '{"hy": "Թարթիչների երկարացում", "ru": "Наращивание ресниц"}', 'Lash artist', '{"hy": "Թարթիչների մասնագետ", "ru": "Лешмейкер"}', ARRAY['лешмейкер', 'lashmaker', 'наращивание ресниц', 'թարթիչ']::TEXT[], 20, true, NOW(), NOW()),
  ('lash-lift', 'brows-lashes', 'Lash lift & lamination', '{"hy": "Թարթիչների լամինացիա", "ru": "Ламинирование ресниц"}', 'Lash lift specialist', '{"hy": "Լամինացիայի մասնագետ", "ru": "Мастер по ламинированию"}', ARRAY['ламинирование', 'lash lift', 'լամինացիա']::TEXT[], 30, true, NOW(), NOW()),
  ('brow-lash-tinting', 'brows-lashes', 'Brow & lash tinting', '{"hy": "Հոնքերի և թարթիչների ներկում", "ru": "Окрашивание бровей и ресниц"}', 'Tinting specialist', '{"hy": "Ներկման մասնագետ", "ru": "Мастер окрашивания"}', ARRAY['окрашивание бровей', 'tinting', 'хна']::TEXT[], 40, true, NOW(), NOW()),
  ('makeup', 'makeup', 'Makeup', '{"hy": "Դիմահարդարում", "ru": "Макияж"}', 'Makeup artist', '{"hy": "Դիմահարդար", "ru": "Визажист"}', ARRAY['визажист', 'makeup artist', 'Դիմահարդար', 'мейкап']::TEXT[], 10, true, NOW(), NOW()),
  ('bridal-makeup', 'makeup', 'Bridal makeup', '{"hy": "Հարսի դիմահարդարում", "ru": "Свадебный макияж"}', 'Bridal makeup artist', '{"hy": "Հարսի դիմահարդար", "ru": "Свадебный визажист"}', ARRAY['свадебный макияж', 'bridal', 'հարս']::TEXT[], 20, true, NOW(), NOW()),
  ('permanent-makeup', 'makeup', 'Permanent makeup', '{"hy": "Մշտական դիմահարդարում", "ru": "Перманентный макияж"}', 'PMU artist', '{"hy": "Պերմանենտ մակիյաժի մասնագետ", "ru": "Мастер перманентного макияжа"}', ARRAY['pmu', 'перманент', 'татуаж', 'permanent makeup']::TEXT[], 30, true, NOW(), NOW()),
  ('cosmetology', 'skin', 'Cosmetology', '{"hy": "Կոսմետոլոգիա", "ru": "Косметология"}', 'Cosmetologist', '{"hy": "Կոսմետոլոգ", "ru": "Косметолог"}', ARRAY['косметолог', 'cosmetologist', 'Կոսմետոլոգ']::TEXT[], 10, true, NOW(), NOW()),
  ('facials', 'skin', 'Facials & skincare', '{"hy": "Դեմքի խնամք", "ru": "Уход за лицом"}', 'Esthetician', '{"hy": "Դեմքի խնամքի մասնագետ", "ru": "Эстетист"}', ARRAY['эстетист', 'чистка лица', 'facial', 'Դեմքի խնամք']::TEXT[], 20, true, NOW(), NOW()),
  ('dermatology', 'skin', 'Dermatology', '{"hy": "Մաշկաբանություն", "ru": "Дерматология"}', 'Dermatologist', '{"hy": "Մաշկաբան", "ru": "Дерматолог"}', ARRAY['дерматолог', 'dermatologist', 'Մաշկաբան']::TEXT[], 30, true, NOW(), NOW()),
  ('aesthetic-medicine', 'skin', 'Aesthetic medicine', '{"hy": "Էսթետիկ բժշկություն", "ru": "Эстетическая медицина"}', 'Aesthetic doctor', '{"hy": "Էսթետիկ բժիշկ", "ru": "Врач-косметолог"}', ARRAY['инъекции', 'ботокс', 'филлеры', 'injectables']::TEXT[], 40, true, NOW(), NOW()),
  ('laser-cosmetology', 'skin', 'Laser & hardware cosmetology', '{"hy": "Լազերային կոսմետոլոգիա", "ru": "Лазерная и аппаратная косметология"}', 'Laser specialist', '{"hy": "Լազերային կոսմետոլոգ", "ru": "Лазерный мастер"}', ARRAY['лазер', 'laser', 'аппаратная косметология']::TEXT[], 50, true, NOW(), NOW()),
  ('chemical-peels', 'skin', 'Chemical peels', '{"hy": "Պիլինգ", "ru": "Пилинги"}', 'Peel specialist', '{"hy": "Պիլինգի մասնագետ", "ru": "Мастер пилингов"}', ARRAY['пилинг', 'peeling', 'Պիլինգ']::TEXT[], 60, true, NOW(), NOW()),
  ('massage', 'body', 'Massage', '{"hy": "Մերսում", "ru": "Массаж"}', 'Massage therapist', '{"hy": "Մերսող", "ru": "Массажист"}', ARRAY['массажист', 'massage', 'Մերսում', 'массаж']::TEXT[], 10, true, NOW(), NOW()),
  ('spa-therapy', 'body', 'Spa therapy', '{"hy": "Սպա թերապիա", "ru": "СПА-терапия"}', 'Spa therapist', '{"hy": "Սպա մասնագետ", "ru": "СПА-терапевт"}', ARRAY['spa', 'спа', 'Սպա']::TEXT[], 20, true, NOW(), NOW()),
  ('body-contouring', 'body', 'Body contouring', '{"hy": "Մարմնի ձևավորում", "ru": "Коррекция фигуры"}', 'Body contouring specialist', '{"hy": "Մարմնի ձևավորման մասնագետ", "ru": "Мастер по коррекции фигуры"}', ARRAY['коррекция фигуры', 'обертывание', 'lpg']::TEXT[], 30, true, NOW(), NOW()),
  ('waxing-sugaring', 'body', 'Waxing & sugaring', '{"hy": "Մոմով և շաքարով մազահեռացում", "ru": "Восковая депиляция и шугаринг"}', 'Depilation specialist', '{"hy": "Մազահեռացման մասնագետ", "ru": "Мастер депиляции"}', ARRAY['шугаринг', 'воск', 'депиляция', 'waxing', 'sugaring']::TEXT[], 40, true, NOW(), NOW()),
  ('laser-hair-removal', 'body', 'Laser hair removal', '{"hy": "Լազերային մազահեռացում", "ru": "Лазерная эпиляция"}', 'Laser hair removal specialist', '{"hy": "Լազերային մազահեռացման մասնագետ", "ru": "Мастер лазерной эпиляции"}', ARRAY['лазерная эпиляция', 'laser epilation', 'эпиляция']::TEXT[], 50, true, NOW(), NOW()),
  ('tanning', 'body', 'Tanning', '{"hy": "Արևայրուք", "ru": "Загар"}', 'Tanning specialist', '{"hy": "Արևայրուքի մասնագետ", "ru": "Мастер по загару"}', ARRAY['солярий', 'загар', 'tanning', 'автозагар']::TEXT[], 60, true, NOW(), NOW()),
  ('general-practice', 'medical', 'General practice', '{"hy": "Ընդհանուր բժշկություն", "ru": "Общая практика"}', 'General practitioner', '{"hy": "Ընդհանուր բժիշկ", "ru": "Терапевт"}', ARRAY['терапевт', 'gp', 'Բժիշկ', 'врач']::TEXT[], 10, true, NOW(), NOW()),
  ('dentistry', 'medical', 'Dentistry', '{"hy": "Ատամնաբուժություն", "ru": "Стоматология"}', 'Dentist', '{"hy": "Ատամնաբույժ", "ru": "Стоматолог"}', ARRAY['стоматолог', 'dentist', 'Ատամնաբույժ', 'зубной']::TEXT[], 20, true, NOW(), NOW()),
  ('dental-hygiene', 'medical', 'Dental hygiene', '{"hy": "Բերանի խոռոչի հիգիենա", "ru": "Гигиена полости рта"}', 'Dental hygienist', '{"hy": "Հիգիենիստ", "ru": "Гигиенист"}', ARRAY['гигиенист', 'чистка зубов', 'hygienist']::TEXT[], 30, true, NOW(), NOW()),
  ('physiotherapy', 'medical', 'Physiotherapy', '{"hy": "Ֆիզիոթերապիա", "ru": "Физиотерапия"}', 'Physiotherapist', '{"hy": "Ֆիզիոթերապևտ", "ru": "Физиотерапевт"}', ARRAY['физиотерапевт', 'physio', 'реабилитация']::TEXT[], 40, true, NOW(), NOW()),
  ('nutrition', 'medical', 'Nutrition & dietetics', '{"hy": "Սննդաբանություն", "ru": "Диетология"}', 'Nutritionist', '{"hy": "Սննդաբան", "ru": "Диетолог"}', ARRAY['диетолог', 'нутрициолог', 'nutritionist']::TEXT[], 50, true, NOW(), NOW()),
  ('nursing', 'medical', 'Nursing', '{"hy": "Բուժքույրական խնամք", "ru": "Сестринское дело"}', 'Nurse', '{"hy": "Բուժքույր", "ru": "Медсестра"}', ARRAY['медсестра', 'медбрат', 'nurse', 'Բուժքույր']::TEXT[], 60, true, NOW(), NOW()),
  ('psychology', 'medical', 'Psychology', '{"hy": "Հոգեբանություն", "ru": "Психология"}', 'Psychologist', '{"hy": "Հոգեբան", "ru": "Психолог"}', ARRAY['психолог', 'psychologist', 'Հոգեբան']::TEXT[], 70, true, NOW(), NOW()),
  ('trichology', 'medical', 'Trichology', '{"hy": "Տրիխոլոգիա", "ru": "Трихология"}', 'Trichologist', '{"hy": "Տրիխոլոգ", "ru": "Трихолог"}', ARRAY['трихолог', 'trichologist']::TEXT[], 80, true, NOW(), NOW()),
  ('podiatry', 'medical', 'Podiatry & foot care', '{"hy": "Ոտնաբուժություն", "ru": "Подология"}', 'Podiatrist', '{"hy": "Ոտնաբույժ", "ru": "Подолог"}', ARRAY['подолог', 'podiatrist', 'медицинский педикюр']::TEXT[], 90, true, NOW(), NOW()),
  ('tattoo', 'tattoo', 'Tattoo', '{"hy": "Դաջվածք", "ru": "Тату"}', 'Tattoo artist', '{"hy": "Դաջվածքի վարպետ", "ru": "Тату-мастер"}', ARRAY['тату', 'tattoo', 'Դաջվածք', 'татуировка']::TEXT[], 10, true, NOW(), NOW()),
  ('piercing', 'tattoo', 'Piercing', '{"hy": "Ծակոց", "ru": "Пирсинг"}', 'Piercing specialist', '{"hy": "Ծակոցի մասնագետ", "ru": "Мастер пирсинга"}', ARRAY['пирсинг', 'piercing', 'Ծակոց']::TEXT[], 20, true, NOW(), NOW()),
  ('tattoo-removal', 'tattoo', 'Tattoo removal', '{"hy": "Դաջվածքի հեռացում", "ru": "Удаление тату"}', 'Tattoo removal specialist', '{"hy": "Դաջվածքի հեռացման մասնագետ", "ru": "Мастер по удалению тату"}', ARRAY['удаление тату', 'laser tattoo removal']::TEXT[], 30, true, NOW(), NOW()),
  ('administration', 'support', 'Administration & reception', '{"hy": "Ադմինիստրացիա", "ru": "Администрирование"}', 'Administrator', '{"hy": "Ադմինիստրատոր", "ru": "Администратор"}', ARRAY['администратор', 'ресепшн', 'reception', 'Ադմինիստրատոր']::TEXT[], 10, true, NOW(), NOW()),
  ('management', 'support', 'Management', '{"hy": "Կառավարում", "ru": "Управление"}', 'Manager', '{"hy": "Մենեջեր", "ru": "Управляющий"}', ARRAY['управляющий', 'менеджер', 'manager', 'Մենեջեր']::TEXT[], 20, true, NOW(), NOW()),
  ('cleaning', 'support', 'Cleaning', '{"hy": "Մաքրություն", "ru": "Уборка"}', 'Cleaner', '{"hy": "Հավաքարար", "ru": "Уборщик"}', ARRAY['уборщица', 'уборщик', 'cleaner', 'Հավաքարար', 'клининг']::TEXT[], 30, true, NOW(), NOW()),
  ('assistant', 'support', 'Assistant & apprentice', '{"hy": "Օգնական", "ru": "Помощник"}', 'Assistant', '{"hy": "Օգնական", "ru": "Ассистент"}', ARRAY['ассистент', 'помощник', 'стажер', 'assistant']::TEXT[], 40, true, NOW(), NOW()),
  ('marketing', 'support', 'Marketing & SMM', '{"hy": "Մարքեթինգ", "ru": "Маркетинг и SMM"}', 'SMM specialist', '{"hy": "SMM մասնագետ", "ru": "SMM-специалист"}', ARRAY['smm', 'маркетолог', 'таргетолог', 'marketing']::TEXT[], 50, true, NOW(), NOW()),
  ('photography', 'support', 'Photography', '{"hy": "Լուսանկարչություն", "ru": "Фотография"}', 'Photographer', '{"hy": "Լուսանկարիչ", "ru": "Фотограф"}', ARRAY['фотограф', 'photographer', 'Լուսանկարիչ', 'видеограф']::TEXT[], 60, true, NOW(), NOW()),
  ('accounting', 'support', 'Accounting', '{"hy": "Հաշվապահություն", "ru": "Бухгалтерия"}', 'Accountant', '{"hy": "Հաշվապահ", "ru": "Бухгалтер"}', ARRAY['бухгалтер', 'accountant', 'Հաշվապահ']::TEXT[], 70, true, NOW(), NOW()),
  ('supply', 'support', 'Supply & delivery', '{"hy": "Մատակարարում", "ru": "Снабжение и доставка"}', 'Supply specialist', '{"hy": "Մատակարար", "ru": "Снабженец"}', ARRAY['курьер', 'снабжение', 'supply', 'доставка']::TEXT[], 80, true, NOW(), NOW()),
  ('security', 'support', 'Security', '{"hy": "Անվտանգություն", "ru": "Охрана"}', 'Security guard', '{"hy": "Պահակ", "ru": "Охранник"}', ARRAY['охранник', 'security', 'Պահակ']::TEXT[], 90, true, NOW(), NOW()),
  ('other', 'other', 'Other', '{"hy": "Այլ", "ru": "Другое"}', 'Other', '{"hy": "Այլ", "ru": "Другое"}', ARRAY['other', 'другое', 'Այլ']::TEXT[], 10, true, NOW(), NOW())
ON CONFLICT ("key") DO NOTHING;

-- Product catalog ------------------------------------------------------------
-- Curated (selfServe = false): platform staff grant it per partner from the
-- internal console. One UPDATE flips it to self-serve once a public
-- vacancies signup exists.
INSERT INTO "products" ("key", "name", "description", "selfServe", "sortOrder", "active", "createdAt", "updatedAt")
VALUES
  ('vacancies', 'Vacancies', 'Open positions, chair rentals and commission places, with applications from professionals.', false, 30, true, NOW(), NOW())
ON CONFLICT ("key") DO NOTHING;
