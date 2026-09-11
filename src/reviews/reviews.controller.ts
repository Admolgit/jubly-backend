import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from 'src/auth/jwt.authGuard';
import { Public } from 'src/auth/public.decorator';
import { Roles, RolesGuard } from 'src/auth/role.guard';
import { CreateReviewDto } from './dto/create-review.dto';
import {
  BookingReviewParamsDto,
  VendorReviewParamsDto,
} from './dto/review-params.dto';
import { ReviewQueryDto } from './dto/review-query.dto';
import { ReviewsService } from './reviews.service';

@Controller('reviews')
export class ReviewsController {
  constructor(private readonly reviewsService: ReviewsService) {}

  @Post(':clientId')
  @Public()
  create(@Param('clientId') clientId: string, @Body() dto: CreateReviewDto) {
    return this.reviewsService.create(clientId, dto);
  }

  @Get('vendor/:vendorId')
  @Public()
  getVendorReviews(
    @Param() params: VendorReviewParamsDto,
    @Query() query: ReviewQueryDto,
  ) {
    return this.reviewsService.getVendorReviews(params.vendorId, query);
  }

  @Get('booking/:bookingId')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('CLIENT')
  getBookingReview(
    @Req() req: { user: { id: string } },
    @Param() params: BookingReviewParamsDto,
  ) {
    return this.reviewsService.getBookingReview(req.user.id, params.bookingId);
  }

  @Get(':vendorId/public-stats')
  @Public()
  getPublicStats(@Param('vendorId') vendorId: string) {
    return this.reviewsService.getPublicStats(vendorId);
  }
}
