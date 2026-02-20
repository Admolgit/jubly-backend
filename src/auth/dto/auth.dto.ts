import { UserRole } from '@prisma/client';

export interface RegisterDto {
  email: string;
  password: string;
  firstName: string;
  lastName: string;
  role: UserRole;
}

export interface LoginDto {
  email: string;
  password: string;
}

export interface PasswordDTO {
  userId: string;
  currentPassword: string;
  newPassword: string;
  confirmPassword: string;
}

export interface PasswordResetDTO {
  email: string;
  newPassword: string;
  confirmPassword: string;
}

export interface RefreshTokenDto {
  refreshToken: string;
}
