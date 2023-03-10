import { Logger } from '@map-colonies/js-logger';
import { inject, injectable } from 'tsyringe';
import { IngestionParams, ProductType } from '@map-colonies/mc-model-types';
import { ICreateJobBody, ICreateJobResponse, IJobResponse, OperationStatus, ITaskResponse, JobManagerClient } from '@map-colonies/mc-priority-queue';
import { NotFoundError } from '@map-colonies/error-types';
import { IConfig, IMergeTaskParams } from '../common/interfaces';
import { SERVICES } from '../common/constants';
import { ITaskParameters } from '../layers/interfaces';
import { ICompletedJobs } from '../jobs/interfaces';

@injectable()
export class JobManagerWrapper extends JobManagerClient {
  private readonly jobDomain: string;

  public constructor(@inject(SERVICES.CONFIG) private readonly config: IConfig, @inject(SERVICES.LOGGER) protected readonly logger: Logger) {
    super(logger, '', '', config.get<string>('jobManagerURL'));
    this.jobDomain = config.get<string>('jobDomain');
  }

  public async createLayerJob(
    data: IngestionParams,
    layerRelativePath: string,
    jobType: string,
    taskType: string,
    taskParams?: (ITaskParameters | IMergeTaskParams)[],
    managerCallbackUrl?: string
  ): Promise<string> {
    const resourceId = data.metadata.productId as string;
    const version = data.metadata.productVersion as string;
    const createLayerTasksUrl = `/jobs`;
    const createJobRequest: CreateJobBody = {
      resourceId: resourceId,
      internalId: data.metadata.id as string,
      version: version,
      type: jobType,
      status: OperationStatus.IN_PROGRESS,
      parameters: { ...data, layerRelativePath, managerCallbackUrl } as unknown as Record<string, unknown>,
      producerName: data.metadata.producerName,
      productName: data.metadata.productName,
      productType: data.metadata.productType,
      domain: this.jobDomain,
      tasks: taskParams?.map((params) => {
        return {
          type: taskType,
          parameters: params,
        };
      }),
    };
    const res = await this.post<ICreateJobResponse>(createLayerTasksUrl, createJobRequest);
    return res.id;
  }

  public async createTasks(jobId: string, taskParams: ITaskParameters[] | IMergeTaskParams[], taskType: string): Promise<void> {
    const createTasksUrl = `/jobs/${jobId}/tasks`;
    const parmas = taskParams as (ITaskParameters | IMergeTaskParams)[];
    const req = parmas.map((params) => {
      return {
        type: taskType,
        parameters: params,
      };
    });
    await this.post(createTasksUrl, req);
  }

  public async getJobById(jobId: string): Promise<ICompletedJobs> {
    const res = await this.getJob<Record<string, unknown>, ITaskParameters | IMergeTaskParams>(jobId);
    if (res === undefined) {
      throw new NotFoundError(`job with ${jobId} is not exists`);
    }
    // eslint-disable-next-line @typescript-eslint/no-magic-numbers
    const jobPercentage = Math.trunc((res.completedTasks / res.taskCount) * 100);
    return {
      id: res.id,
      internalId: res.internalId as string,
      status: res.status,
      isCompleted: res.completedTasks + res.failedTasks + res.expiredTasks + res.abortedTasks === res.taskCount,
      isSuccessful: res.completedTasks === res.taskCount,
      percentage: jobPercentage,
      metadata: (res.parameters as unknown as IngestionParams).metadata,
      relativePath: (res.parameters as unknown as { layerRelativePath: string }).layerRelativePath,
      successTasksCount: res.completedTasks,
      type: res.type,
    };
  }

  public async getTaskById(jobId: string, taskId: string): Promise<TaskResponse> {
    const res = await this.getTask<ITaskParameters>(jobId, taskId);
    if (res === null) {
      throw new NotFoundError(`taskId: ${taskId}, jobId: ${jobId} is not exists`);
    }
    return res;
  }

  public async updateJobById(jobId: string, status: OperationStatus, jobPercentage?: number, reason?: string, catalogId?: string): Promise<void> {
    const updateJobBody = {
      status: status,
      reason: reason,
      internalId: catalogId,
      percentage: jobPercentage,
    };
    await this.updateJob(jobId, updateJobBody);
  }

  public async findJobs(resourceId: string, productType: ProductType): Promise<JobResponse[]> {
    const res = this.getJobs<Record<string, unknown>, ITaskParameters | IMergeTaskParams>(resourceId, productType);
    return res;
  }

  public async findJobsByInternalId(internalId: string): Promise<JobResponse[]> {
    const res = this.getJobByInternalId<Record<string, unknown>, ITaskParameters | IMergeTaskParams>(internalId);
    return res;
  }
}

export type JobResponse = IJobResponse<Record<string, unknown>, ITaskParameters | IMergeTaskParams>;
export type TaskResponse = ITaskResponse<ITaskParameters>;
export type CreateJobBody = ICreateJobBody<Record<string, unknown>, ITaskParameters | IMergeTaskParams>;
