import { HttpStatus } from '@nestjs/common';

export function successResponse<T>(
  data: T,
  message = 'Successful',
  status = HttpStatus.OK,
  meta?: Record<string, any>,
) {
  return {
    status,
    data,
    message,
    meta: meta || null,
  };
}
export function errorResponse<T>(
  data: T,
  message = 'Unsuccessful',
  status = HttpStatus.BAD_REQUEST,
) {
  return {
    status,
    data,
    message,
  };
}
