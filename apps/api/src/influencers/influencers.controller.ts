import { Body, Controller, Delete, Get, Param, Patch, Post, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { InfluencersService } from './influencers.service';

@Controller('influencers')
export class InfluencersController {
  constructor(private readonly influencers: InfluencersService) {}

  @Get('summary')
  summary() {
    return this.influencers.summary();
  }

  @Get('stats')
  stats() {
    return this.influencers.summary();
  }

  @Get()
  list(@Query('stage') stage?: string, @Query('q') q?: string) {
    return this.influencers.list({ stage, q });
  }

  @Post()
  create(@Body() body: CreateInfluencerBody) {
    return this.influencers.createInfluencer(body);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() body: UpdateInfluencerBody) {
    return this.influencers.updateInfluencer(id, body);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.influencers.deleteInfluencer(id);
  }

  @Post(':id/collaborations')
  createCollaboration(@Param('id') influencerId: string, @Body() body: CreateCollaborationBody) {
    return this.influencers.createCollaboration(influencerId, body);
  }

  @Patch('collaborations/:id')
  updateCollaboration(@Param('id') id: string, @Body() body: UpdateCollaborationBody) {
    return this.influencers.updateCollaboration(id, body);
  }

  @Post(':id/submissions')
  createSubmission(@Param('id') influencerId: string, @Body() body: CreateSubmissionBody) {
    return this.influencers.createSubmission(influencerId, body);
  }

  @Post(':id/submissions/upload')
  uploadSubmission(@Param('id') influencerId: string, @Body() body: UploadSubmissionBody) {
    return this.influencers.uploadSubmission(influencerId, body);
  }

  @Get('submissions/:id/video')
  async submissionVideo(@Param('id') id: string, @Res() response: Response) {
    const file = await this.influencers.getSubmissionVideo(id);
    response.setHeader('Content-Type', file.mimeType);
    response.setHeader('Content-Length', String(file.size));
    response.setHeader('Content-Disposition', `inline; filename="${file.filename.replace(/"/g, '')}"`);
    file.stream.pipe(response);
  }

  @Patch('submissions/:id')
  updateSubmission(@Param('id') id: string, @Body() body: UpdateSubmissionBody) {
    return this.influencers.updateSubmission(id, body);
  }
}

export interface CreateInfluencerBody {
  igHandle: string;
  fullName?: string;
  manychatId?: string;
  followers?: number;
  email?: string;
  stage?: string;
  tags?: string[];
  notes?: string;
  source?: string;
  detectionScore?: number;
  detectionReason?: string;
  suggestedAction?: string;
  lastMessage?: string;
  lastMessageAt?: string;
  firstDetectedAt?: string;
  lastInboundAt?: string;
}

export interface UpdateInfluencerBody extends Partial<CreateInfluencerBody> {
  lastMessage?: string;
  lastMessageAt?: string;
  firstDetectedAt?: string;
  lastInboundAt?: string;
}

export interface CreateCollaborationBody {
  title: string;
  status?: string;
  type?: string;
  compensation?: number;
  productSent?: string;
  deliverables?: string;
  discountCode?: string;
  metaCampaignId?: string;
  deadline?: string;
  notes?: string;
}

export interface UpdateCollaborationBody extends Partial<CreateCollaborationBody> {
  closedAt?: string;
}

export interface CreateSubmissionBody {
  collaborationId?: string;
  videoUrl?: string;
  thumbnailUrl?: string;
  originalFilename?: string;
  mimeType?: string;
  fileSizeBytes?: number;
  storageProvider?: string;
  storageKey?: string;
  source?: string;
  usageRights?: string;
  caption?: string;
  type?: string;
  status?: string;
  metaCampaignId?: string;
  receivedAt?: string;
  approvedForAdsAt?: string;
  notes?: string;
}

export interface UpdateSubmissionBody extends Partial<CreateSubmissionBody> {}

export interface UploadSubmissionBody extends CreateSubmissionBody {
  filename: string;
  mimeType: string;
  videoBase64: string;
}

@Controller('infuencers')
export class InfluencersCompatController {
  constructor(private readonly influencers: InfluencersService) {}

  @Get('summary')
  summary() {
    return this.influencers.summary();
  }

  @Get('stats')
  stats() {
    return this.influencers.summary();
  }

  @Get()
  list(@Query('stage') stage?: string, @Query('q') q?: string) {
    return this.influencers.list({ stage, q });
  }
}
