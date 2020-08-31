import addressparser from 'addressparser';
import {copy, emptyDir, remove, pathExists} from 'fs-extra';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as core from '@actions/core';
import * as git from './git';

async function deployFrontend(oldDir: string, newDir: string, currentDir: string){
  try {
    // 前端界面部署
    // 用 build 文件夹中的内容覆盖所有内容
    await copy(path.join(currentDir, 'build'), newDir);
    // 保留 api 文件夹
    await copy(path.join(oldDir, 'api'), path.join(newDir, 'api'));
    // 保留 media 文件夹
    // TODO: 后续废弃此部分处理，改用 assets
    await copy(path.join(oldDir, 'media'), path.join(newDir, 'media'));
    // 保留 assets 文件夹
    await copy(path.join(oldDir, 'assets'), path.join(newDir, 'assets'));
  } catch (error) {
    core.setFailed(error.message);
  }
}

async function deployBackend(oldDir: string, newDir: string, currentDir: string){
  try {
    // 后端数据部署
    // 将先前的结果拷贝到目标文件夹
    await copy(oldDir, newDir);
    // 更新 api
    await emptyDir(path.join(newDir, 'api'));
    await copy(path.join(currentDir, 'build/api'), path.join(newDir, 'api'));
    // 更新 media
    // TODO: 后续废弃此部分处理，改用 assets
    await emptyDir(path.join(newDir, 'media'));
    await copy(path.join(currentDir, 'build/media'), path.join(newDir, 'media'));
  } catch (error) {
    core.setFailed(error.message);
  }
}

async function deployAssets(oldDir: string, newDir: string, currentDir: string){
  try {
    // 二进制数据部署
    // 将先前的结果拷贝到目标文件夹
    await copy(oldDir, newDir);
    // 更新 assets
    await emptyDir(path.join(newDir, 'assets'));
    await copy(path.join(currentDir, 'assets'), path.join(newDir, 'assets'));
  } catch (error) {
    core.setFailed(error.message);
  }
}

async function deployBackendAssets(oldDir: string, newDir: string, currentDir: string){
  try {
    // 将变动后的二进制数据更新到 assets 分支
    // 用 build/assets 文件夹中的内容覆盖所有内容
    await remove(path.join(currentDir, 'build/assets', '.git'));
    await copy(path.join(currentDir, 'build/assets'), newDir);
  } catch (error) {
    core.setFailed(error.message);
  }
}

async function getRemoteUrl(targetBranch: string): Promise<string>{
  const repo: string = process.env['GITHUB_REPOSITORY'] || '';

  let remoteURL = String('https://');
  if (process.env['GITHUB_TOKEN']) {
    remoteURL = remoteURL.concat('x-access-token:', process.env['GITHUB_TOKEN'].trim());
  } else {
    core.setFailed('You have to provide a GITHUB_TOKEN');
    return '';
  }
  remoteURL = remoteURL.concat('@github.com/', repo, '.git');
  const remoteBranchExists: boolean = await git.remoteBranchExists(remoteURL, targetBranch);
  if (!remoteBranchExists) {
    core.setFailed('Remote branch not exist');
    return '';
  }
  return remoteURL;
}

async function run() {
  try {
    const deployType: string = core.getInput('deploy_type');
    let targetBranch: string = 'gh-pages';
    const committer: string = git.defaults.committer;
    const author: string = git.defaults.author;
    const commitMessage: string = git.defaults.message;

    const currentDir = path.resolve('.');
    if (deployType === "backend-assets"){
      // backend/build/assets 文件夹不存在时，直接结束
      if (!await pathExists(path.join(currentDir, 'build/assets'))){ return }
      targetBranch = 'assets'
    }
    const oldDir = fs.mkdtempSync(path.join(os.tmpdir(), 'branch-old'));
    const newDir = fs.mkdtempSync(path.join(os.tmpdir(), 'branch-new'));

    let remoteURL: string = await getRemoteUrl(targetBranch);
    if (!remoteURL){ return }

    // 将当前的分支内容拉取到 oldDir
    process.chdir(oldDir);
    await git.clone(remoteURL, targetBranch, '.');
    await remove(path.join(oldDir, '.git'));

    // 创建一个空的分支到 newDir
    process.chdir(newDir);
    await git.init('.');
    await git.checkout(targetBranch);

    // 根据部署类型，确定如何更新分支中的内容
    process.chdir(currentDir);
    if (deployType === "frontend"){
      await deployFrontend(oldDir, newDir, currentDir)
    } else if (deployType === "backend"){
      await deployBackend(oldDir, newDir, currentDir)
    } else if (deployType === "assets"){
      await deployAssets(oldDir, newDir, currentDir)
    } else if (deployType === "backend-assets"){
      await deployBackendAssets(oldDir, newDir, currentDir)
    }

    // 将 newDir 的内容强制推送到目标分支
    process.chdir(newDir);
    const isDirty: boolean = await git.isDirty();
    if (!isDirty) {
      core.info('No changes to commit');
      return;
    }
    const committerPrs: addressparser.Address = addressparser(committer)[0];
    await git.setConfig('user.name', committerPrs.name);
    await git.setConfig('user.email', committerPrs.address);
    if (!(await git.hasChanges())) {
      core.info('Nothing to deploy');
      return;
    }
    await git.add('.');
    const authorPrs: addressparser.Address = addressparser(author)[0];
    await git.commit(true, `${authorPrs.name} <${authorPrs.address}>`, commitMessage);
    await git.showStat(10).then(output => { core.info(output); });
    await git.push(remoteURL, targetBranch, true);

    process.chdir(currentDir);

    core.info(`Content has been deployed to GitHub Pages`);
  } catch (error) {
    core.setFailed(error.message);
  }
}

run();
