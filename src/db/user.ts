import { Entity, PrimaryGeneratedColumn, Column, Unique, Repository } from "typeorm"

@Entity()
@Unique(["id", "telegramId", "telegramUsername"])
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

  @Column("varchar", {
    unique: true,
    nullable: true,
  })
  address: string;

  toString(): string {
    return `user TG "${this.telegramUsername}" (id: ${this.telegramId})`;
  }

  toJSON(): string {
    return JSON.stringify(this);
  }
}

export const getUserFromTgId = (userRepository: Repository<User>, userId: number): Promise<User> => {
  return userRepository.findOneBy({ telegramId: userId });
}