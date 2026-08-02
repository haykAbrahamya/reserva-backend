import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiConsumes } from '@nestjs/swagger';
import { CoursesService } from './courses.service';
import { CohortsService } from './cohorts.service';
import { EnrollmentsService } from './enrollments.service';
import { CourseCoverService } from './course-cover.service';
import { CurrentUser } from '@/auth/decorators';
import type { AuthUser } from '@/auth/auth.types';
import { CreateCourseDto, UpdateCourseDto, ListCourseQueryDto } from './dto/course.dto';
import { UpdateCohortDto, CohortActionDto, StartNewRunDto } from './dto/cohort.dto';
import {
  AddEnrollmentDto,
  UpdateEnrollmentDto,
  EnrollmentStatusDto,
  ListEnrollmentQueryDto,
} from './dto/enrollment.dto';

// 8 MB cap on the raw upload (sharp shrinks it to a WebP afterwards).
const MAX_UPLOAD_BYTES = 8 * 1024 * 1024;

/**
 * Backoffice course management. Routes are grouped by resource:
 *   /courses                     — course templates (CRUD)
 *   /courses/:id/cover           — cover image
 *   /courses/:id/runs            — the current run + history + new run
 *   /courses/runs/:cohortId      — a run's details + lifecycle
 *   /courses/runs/:cohortId/members — enrollments (list + add)
 *   /courses/members/:id         — a single member (edit / status / remove)
 * Every handler is tenant-scoped via the JWT's partnerId.
 */
@ApiTags('Courses')
@ApiBearerAuth()
@Controller('courses')
export class CoursesController {
  constructor(
    private readonly courses: CoursesService,
    private readonly cohorts: CohortsService,
    private readonly enrollments: EnrollmentsService,
    private readonly covers: CourseCoverService,
  ) {}

  // ── Courses ───────────────────────────────────────────────

  @Get()
  @ApiOperation({ summary: "List the partner's courses" })
  list(@CurrentUser() user: AuthUser, @Query() q: ListCourseQueryDto) {
    return this.courses.list(user.partnerId, q);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a course' })
  get(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.courses.get(user.partnerId, id);
  }

  @Post()
  @ApiOperation({ summary: 'Create a course (with its first run)' })
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateCourseDto) {
    return this.courses.create(user.partnerId, dto);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update a course' })
  update(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: UpdateCourseDto) {
    return this.courses.update(user.partnerId, id, dto);
  }

  @Delete(':id')
  @HttpCode(204)
  @ApiOperation({ summary: 'Soft-delete a course' })
  async remove(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    await this.courses.remove(user.partnerId, id);
  }

  // ── Cover image ───────────────────────────────────────────

  @Post(':id/cover')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_UPLOAD_BYTES, files: 1 } }))
  @ApiConsumes('multipart/form-data')
  @ApiOperation({ summary: "Upload a course's cover image" })
  uploadCover(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @UploadedFile() file: { buffer: Buffer; mimetype: string },
  ) {
    return this.covers.setCover(user.partnerId, id, file);
  }

  @Delete(':id/cover')
  @ApiOperation({ summary: "Remove a course's cover image" })
  removeCover(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.covers.removeCover(user.partnerId, id);
  }

  // ── Runs (cohorts) ────────────────────────────────────────

  @Get(':id/runs/current')
  @ApiOperation({ summary: "Get a course's current run" })
  currentRun(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.cohorts.getCurrent(user.partnerId, id);
  }

  @Get(':id/runs/history')
  @ApiOperation({ summary: "List a course's past runs" })
  runHistory(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.cohorts.listHistory(user.partnerId, id);
  }

  @Post(':id/runs')
  @ApiOperation({ summary: 'Start a new run (archive the current one)' })
  startNewRun(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: StartNewRunDto) {
    return this.cohorts.startNewRun(user.partnerId, id, dto);
  }

  @Patch('runs/:cohortId')
  @ApiOperation({ summary: "Update a run's details" })
  updateRun(@CurrentUser() user: AuthUser, @Param('cohortId') cohortId: string, @Body() dto: UpdateCohortDto) {
    return this.cohorts.update(user.partnerId, cohortId, dto);
  }

  @Post('runs/:cohortId/transition')
  @ApiOperation({ summary: 'Apply a lifecycle transition to a run' })
  transitionRun(
    @CurrentUser() user: AuthUser,
    @Param('cohortId') cohortId: string,
    @Body() dto: CohortActionDto,
  ) {
    return this.cohorts.transition(user.partnerId, cohortId, dto.action);
  }

  // ── Members (enrollments) ─────────────────────────────────

  @Get('runs/:cohortId/members')
  @ApiOperation({ summary: 'List members of a run' })
  listMembers(
    @CurrentUser() user: AuthUser,
    @Param('cohortId') cohortId: string,
    @Query() q: ListEnrollmentQueryDto,
  ) {
    return this.enrollments.list(user.partnerId, cohortId, q);
  }

  @Post('runs/:cohortId/members')
  @ApiOperation({ summary: 'Add a member to a run manually' })
  addMember(
    @CurrentUser() user: AuthUser,
    @Param('cohortId') cohortId: string,
    @Body() dto: AddEnrollmentDto,
  ) {
    return this.enrollments.addManual(user.partnerId, cohortId, dto, user.id);
  }

  @Patch('members/:id')
  @ApiOperation({ summary: "Edit a member's contact / notes" })
  updateMember(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: UpdateEnrollmentDto) {
    return this.enrollments.update(user.partnerId, id, dto);
  }

  @Patch('members/:id/status')
  @ApiOperation({ summary: "Change a member's status (confirm / cancel / …)" })
  setMemberStatus(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: EnrollmentStatusDto,
  ) {
    return this.enrollments.setStatus(user.partnerId, id, dto.status);
  }

  @Delete('members/:id')
  @HttpCode(204)
  @ApiOperation({ summary: 'Remove a member from a run' })
  async removeMember(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    await this.enrollments.remove(user.partnerId, id);
  }
}
