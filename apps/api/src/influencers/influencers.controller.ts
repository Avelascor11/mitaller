import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { InfluencersService } from './influencers.service';

@Controller('influencers')
export class InfluencersController {
  constructor(private readonly influencers: InfluencersService) {}

  @Get('summary')
  summary() {
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
}

export interface UpdateInfluencerBody extends Partial<CreateInfluencerBody> {
  lastMessage?: string;
  lastMessageAt?: string;
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
  caption?: string;
  type?: string;
  status?: string;
  metaCampaignId?: string;
}

export interface UpdateSubmissionBody extends Partial<CreateSubmissionBody> {}
