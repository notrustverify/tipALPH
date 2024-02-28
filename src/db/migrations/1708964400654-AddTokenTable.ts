import { MigrationInterface, QueryRunner } from "typeorm";

export class AddTokenTable1708964400654 implements MigrationInterface {
    name = 'AddTokenTable1708964400654'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TABLE "token" ("id" varchar PRIMARY KEY NOT NULL, "name" varchar NOT NULL, "symbol" varchar NOT NULL, "decimals" integer NOT NULL, "description" varchar, "logoURI" varchar, CONSTRAINT "UQ_f0975e95068969f6fc432848166" UNIQUE ("id", "symbol"))`);
        await queryRunner.query(`CREATE INDEX "IDX_f0975e95068969f6fc43284816" ON "token" ("id", "symbol") `);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`DROP INDEX "IDX_f0975e95068969f6fc43284816"`);
        await queryRunner.query(`DROP TABLE "token"`);
    }

}
