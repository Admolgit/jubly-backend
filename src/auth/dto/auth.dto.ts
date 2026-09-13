import { UserRole } from '@prisma/client';
import {
  IsEmail,
  IsNotEmpty,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';

export interface RegisterDto {
  email: string;
  password: string | null;
  firstName: string;
  lastName: string;
  phone: string;
  role: UserRole;
}

export interface LoginDto {
  email: string;
  password: string | null;
}

export interface PasswordDTO {
  userId: string;
  currentPassword: string;
  newPassword: string;
  confirmPassword: string;
}

export class ForgotPasswordDto {
  @IsEmail()
  @MaxLength(254)
  email!: string;
}

export class PasswordResetDTO {
  @IsString()
  @IsNotEmpty()
  @MaxLength(4096)
  token!: string;

  @IsString()
  @MinLength(8)
  @MaxLength(72)
  newPassword!: string;

  @IsString()
  @MinLength(8)
  @MaxLength(72)
  confirmPassword!: string;
}

export interface RefreshTokenDto {
  refreshToken: string;
}
