import { Entity, PrimaryGeneratedColumn, Column } from "typeorm"

@Entity()
export class User {
  constructor(telegramId: number, telegramUsername: string) {
    this.telegramId = telegramId;
    this.telegramUsername = telegramUsername;
  }

  @PrimaryGeneratedColumn()
  id: number;

  @Column("int")
  telegramId: number;
  
  @Column("varchar")
  telegramUsername: string;
}