import { Entity, PrimaryColumn, Column, Unique, Index } from "typeorm"
import { ALPHSymbol } from "../tokenManager";

@Entity()
@Unique(["id", "symbol"])
@Index(["id", "symbol"])
export class Token {
  constructor(id: string, name: string, symbol: string, decimals: number, description?: string, logoURI?: string) {
    this.id = id;
    this.name = name;
    this.symbol = symbol;
    this.decimals = decimals;
    this.description = description;
    this.logoURI = logoURI;
  }

  @PrimaryColumn("varchar")
  id: string;

  @Column("varchar")
  name: string;

  @Column("varchar")
  symbol: string;

  @Column("int")
  decimals: number;

  @Column("varchar", { nullable: true })
  description?: string;

  @Column("varchar", { nullable: true })
  logoURI?: string;

  public toString = (): string => `${this.symbol} (id: ${this.id})`;

  isALPH(): boolean {
    return ALPHSymbol === this.symbol;
  }

  toJSON(): string {
    return JSON.stringify(this);
  }
}