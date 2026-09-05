import { Module } from '@nestjs/common';
import { OptionalProfessionalGuard } from '@/professionals/guards/optional-professional.guard';
import { VacanciesModule } from '@/modules/vacancies/vacancies.module';
import { BoardController } from './board.controller';
import { BoardService } from './board.service';

/**
 * The public vacancies board (vacancies.reserva.am).
 *
 * A separate module from `VacanciesModule` because it is a separate audience
 * with a separate contract: the partner module answers "what have I posted",
 * this one answers "what can I apply to", and the two must not share a
 * serializer — the whole point of board.view.ts is that a column added for the
 * backoffice cannot leak onto a public page by accident.
 *
 * Depends on VacanciesModule for application writes (one owner of that table)
 * and on the globally-provided area and specialty catalogs.
 */
@Module({
  imports: [VacanciesModule],
  controllers: [BoardController],
  providers: [OptionalProfessionalGuard, BoardService],
})
export class BoardModule {}
