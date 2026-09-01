import { IsIn } from 'class-validator';

const ORDER_STATUSES = ['confirmed', 'shipped', 'delivered', 'cancelled'] as const;

export class UpdateOrderStatusDto {
  @IsIn(ORDER_STATUSES)
  status!: 'confirmed' | 'shipped' | 'delivered' | 'cancelled';
}
