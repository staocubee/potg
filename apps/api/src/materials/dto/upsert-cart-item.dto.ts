import { IsInt, IsString, Min } from 'class-validator';

export class UpsertCartItemDto {
  @IsString()
  productId!: string;

  // 0 (or below) removes the item — same "0 clears it" shape other
  // optional-field updates in this scaffold use for a plain value.
  @IsInt()
  @Min(0)
  quantity!: number;
}
