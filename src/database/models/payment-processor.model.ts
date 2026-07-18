import { CreationOptional, InferAttributes, InferCreationAttributes } from 'sequelize';
import { Column, CreatedAt, DataType, Model, Table, UpdatedAt } from 'sequelize-typescript';

@Table({
  tableName: 'payment_processors',
  timestamps: true,
  underscored: true,
  indexes: [{ name: 'UQ_payment_processor_name', unique: true, fields: ['name'] }],
})
export class paymentProcessorModel extends Model<
  InferAttributes<paymentProcessorModel>,
  InferCreationAttributes<paymentProcessorModel>
> {
  @Column({ type: DataType.UUID, primaryKey: true, defaultValue: DataType.UUIDV4 })
  declare id: CreationOptional<string>;

  @Column({ type: DataType.STRING(30), allowNull: false })
  declare name: string;

  @Column({ type: DataType.STRING(60), allowNull: false, field: 'display_name' })
  declare displayName: string;

  @Column({ type: DataType.BOOLEAN, allowNull: false, defaultValue: false, field: 'is_active' })
  declare isActive: CreationOptional<boolean>;

  @CreatedAt
  declare createdAt: CreationOptional<Date>;

  @UpdatedAt
  declare updatedAt: CreationOptional<Date>;
}
