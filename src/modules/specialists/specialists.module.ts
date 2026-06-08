import { Module } from '@nestjs/common';
import { SpecialistsService } from './specialists.service';
import { TimeOffService } from './time-off.service';
import { SpecialistsController } from './specialists.controller';

@Module({
  controllers: [SpecialistsController],
  providers: [SpecialistsService, TimeOffService],
  exports: [SpecialistsService, TimeOffService],
})
export class SpecialistsModule {}
