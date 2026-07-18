import { CreationOptional, InferAttributes, InferCreationAttributes } from 'sequelize';
import { Column, CreatedAt, DataType, Model, Table } from 'sequelize-typescript';

@Table({
  tableName: 'webhook_events',
  timestamps: true,
  updatedAt: false,
  underscored: true,
  indexes: [
    {
      name: 'UQ_webhook_provider_event',
      unique: true,
      fields: ['provider_name', 'provider_event_id'],
    },
  ],
})
export class webhookEventModel extends Model<
  InferAttributes<webhookEventModel>,
  InferCreationAttributes<webhookEventModel>
> {
  @Column({ type: DataType.UUID, primaryKey: true, defaultValue: DataType.UUIDV4 })
  declare id: CreationOptional<string>;

  @Column({ type: DataType.STRING(30), allowNull: false, field: 'provider_name' })
  declare providerName: string;

  @Column({ type: DataType.STRING, allowNull: false, field: 'provider_event_id' })
  declare providerEventId: string;

  @Column({ type: DataType.STRING(50), allowNull: false, field: 'event_type' })
  declare eventType: string;

  @Column({ type: DataType.STRING, allowNull: true, field: 'provider_reference' })
  declare providerReference: CreationOptional<string | null>;

  @Column({ type: DataType.STRING(20), allowNull: false, defaultValue: 'processed' })
  declare status: CreationOptional<string>;

  @CreatedAt
  declare createdAt: CreationOptional<Date>;
}
