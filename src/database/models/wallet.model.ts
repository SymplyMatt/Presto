import { CreationOptional, InferAttributes, InferCreationAttributes } from 'sequelize';
import { Column, CreatedAt, DataType, Model, Table, UpdatedAt } from 'sequelize-typescript';

@Table({
  tableName: 'wallets',
  timestamps: true,
  underscored: true,
  indexes: [{ name: 'UQ_wallets_user', unique: true, fields: ['user_id'] }],
})
export class walletModel extends Model<
  InferAttributes<walletModel>,
  InferCreationAttributes<walletModel>
> {
  @Column({ type: DataType.UUID, primaryKey: true, defaultValue: DataType.UUIDV4 })
  declare id: CreationOptional<string>;

  @Column({
    type: DataType.UUID,
    allowNull: false,
    field: 'user_id',
    references: { model: 'users', key: 'id' },
    onDelete: 'CASCADE',
  })
  declare userId: string;

  @Column({ type: DataType.BIGINT, allowNull: false, defaultValue: 0 })
  declare balance: CreationOptional<number>;

  @Column({ type: DataType.STRING(3), allowNull: false, defaultValue: 'NGN' })
  declare currency: CreationOptional<string>;

  @CreatedAt
  declare createdAt: CreationOptional<Date>;

  @UpdatedAt
  declare updatedAt: CreationOptional<Date>;
}
