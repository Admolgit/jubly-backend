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

  @Post()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('CLIENT')
  create(@Req() req: { user: { id: string } }, @Body() dto: CreateReviewDto) {
    return this.reviewsService.create(req.user.id, dto);
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
}
