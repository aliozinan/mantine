import path from 'node:path';
import chalk from 'chalk';
import fs from 'fs-extra';
import _ from 'lodash';
import { getBuildTime } from '../build/get-build-time';
import { getPackagesBuildOrder } from '../build/get-packages-build-order';
import { getPackageName } from '../packages/get-package-name';
import { locatePackage } from '../packages/locate-package';
import { createLogger } from '../utils/signale';

const logger = createLogger('prepare-all-packages');

const pathRegex: RegExp = /'([^']*)'/i;

type ExportStatement = {
  statements: string[];
  source: string;
};

const fixFileContent = (fileContent: string) => {
  if (!fileContent.length) {
    return null;
  }
  return fileContent
    .trim()
    .replace(/^\/\/.*$/gm, '')
    .replace(/(\n|\r\n)*/g, '')
    .replace(/(,(\s)?})/g, ' }')
    .replace(/[ \t]+/g, ' ')
    .replace(/}export/g, '};export')
    .split(';')
    .filter((line) => line.startsWith('export'))
    .join('\n\n');
};

const fixLine = (line: string) =>
  line
    .replace(/\s\s/g, ' ')
    .replace(/\/\//g, '/')
    .replace(/\.tsx?\/?.*/, '');

const findExportStatement = (
  packageName: string,
  fileContent: string,
  packagePath: string,
  exportStatements: ExportStatement[] = []
): ExportStatement[] => {
  for (const line of fileContent.split('\n')) {
    if (line.trim().startsWith('export')) {
      if (line.trim().startsWith('export * from')) {
        let pathMatch: RegExpExecArray | string | null = pathRegex.exec(line);
        if (pathMatch) {
          pathMatch = pathMatch[1].replace("'", '');
          let filePath: string = '';
          if (fs.existsSync(path.join(packagePath, `${pathMatch}.ts`))) {
            filePath = path.join(packagePath, `${pathMatch}.ts`);
          } else if (fs.existsSync(path.join(packagePath, `${pathMatch}.tsx`))) {
            filePath = path.join(packagePath, `${pathMatch}.tsx`);
          } else if (fs.existsSync(path.join(packagePath, pathMatch, 'index.ts'))) {
            filePath = path.join(packagePath, pathMatch, 'index.ts');
          } else if (
            fs.existsSync(path.join(packagePath.replace('index.ts', ''), `${pathMatch}.ts`))
          ) {
            filePath = path.join(packagePath.replace('index.ts', ''), `${pathMatch}.ts`);
          } else if (
            fs.existsSync(path.join(packagePath.replace('index.ts', ''), `${pathMatch}.tsx`))
          ) {
            filePath = path.join(packagePath.replace('index.ts', ''), `${pathMatch}.tsx`);
          } else if (
            fs.existsSync(path.join(packagePath.replace('index.ts', ''), pathMatch, 'index.ts'))
          ) {
            filePath = path.join(packagePath.replace('index.ts', ''), pathMatch, 'index.ts');
          } else if (
            fs.existsSync(
              path.join(packagePath.replace('index.ts', ''), pathMatch, `${pathMatch}.ts`)
            )
          ) {
            filePath = path.join(packagePath.replace('index.ts', ''), pathMatch, `${pathMatch}.ts`);
          } else if (
            fs.existsSync(
              path.join(packagePath.replace('index.ts', ''), pathMatch, `${pathMatch}.tsx`)
            )
          ) {
            filePath = path.join(
              packagePath.replace('index.ts', ''),
              pathMatch,
              `${pathMatch}.tsx`
            );
          } else {
            console.log(chalk.cyanBright('something else *!', packagePath, pathMatch));
          }
          const newFileContent: string | null =
            filePath && fixFileContent(fs.readFileSync(filePath, 'utf-8'));
          if (newFileContent) {
            findExportStatement(packageName, newFileContent, filePath, exportStatements);
          }
        }
      } else if (line.trim().startsWith('export * as')) {
        const statementRegex: RegExp = /(?<=\bas\b\s)(.*?)(?=\sfrom)/gi;
        const statementMatch = statementRegex.exec(line);
        const pathMatch = pathRegex.exec(line);
        if (statementMatch) {
          const absolutePath = fixLine(
            path
              .relative(
                './@types',
                pathMatch ? path.join(packagePath, pathMatch[1].replace("'", '')) : packagePath
              )
              .replace('index.ts', '')
          );
          const exportStatement = statementMatch[0];
          exportStatements.push({
            statements: [exportStatement],
            source: absolutePath,
          });
        }
      } else if (line.trim().startsWith('export {')) {
        const pathMatch = pathRegex.exec(line);
        const statementRegex: RegExp = /(?<={)\s*\b(.*?)\b\s*(?=})/i;
        const statementMatch = statementRegex.exec(line);
        if (statementMatch) {
          const absolutePath = fixLine(
            path
              .relative(
                './@types',
                pathMatch ? path.join(packagePath, pathMatch[1].replace("'", '')) : packagePath
              )
              .replace('index.ts', '')
          );
          const exportStatement = statementMatch[1].split(', ');
          exportStatements.push({
            statements: exportStatement,
            source: absolutePath,
          });
        }
      } else if (line.trim().startsWith('export const')) {
        let statementRegex: RegExp | null = null;
        if (line.startsWith('export const [')) {
          statementRegex = /\[(.*?)]/i;
        } else if (line.startsWith('export const {')) {
          statementRegex = /=\s*(\w+)/i;
        } else {
          statementRegex = /export\s+const\s+(.*?)\s*=/i;
        }
        const statementMatch = statementRegex.exec(line);
        if (statementMatch) {
          const absolutePath = fixLine(
            path.relative('./@types', packagePath).replace('index.ts', '')
          );
          const exportStatement = statementMatch[1].replace(/:.*/, '').split(', ');
          exportStatements.push({
            statements: exportStatement,
            source: absolutePath,
          });
        }
      } else if (line.trim().startsWith('export type')) {
        const pathMatch = pathRegex.exec(line);
        const statementRegex: RegExp =
          /(?<={\s*)\b(.*?)\b(?=\s*})|(?<=\bexport\stype\s)\b\w+\b\s*(?=(?:\s=)|<|:\s*)/gi;
        const statementMatch = statementRegex.exec(line);
        if (statementMatch && statementMatch[0]) {
          const absolutePath = fixLine(
            path
              .relative(
                './@types',
                pathMatch ? path.join(packagePath, pathMatch[1].replace("'", '')) : packagePath
              )
              .replace('index.ts', '')
          );
          const exportStatement = statementMatch[0]
            .split(', ')
            .map((statement: string) => `type ${statement}`);
          exportStatements.push({
            statements: exportStatement,
            source: absolutePath,
          });
        }
      } else if (line.trim().startsWith('export function')) {
        const pathMatch = pathRegex.exec(line);
        const statementRegex: RegExp = /(?<=\bfunction\b\s*)(\w+)(?=(?:\s*)\(|<)/i;
        const statementMatch = statementRegex.exec(line);
        if (statementMatch) {
          const absolutePath = fixLine(
            path
              .relative(
                './@types',
                pathMatch ? path.join(packagePath, pathMatch[1].replace("'", '')) : packagePath
              )
              .replace('index.ts', '')
          );
          const exportStatement = statementMatch[1];
          exportStatements.push({
            statements: [exportStatement],
            source: absolutePath,
          });
        }
      } else if (line.trim().startsWith('export interface')) {
        const pathMatch = pathRegex.exec(line);
        const statementRegex: RegExp = /(?<=\binterface\b\s)(\w+)(?=\s*[<{])/gi;
        const statementMatch = statementRegex.exec(line);
        if (statementMatch) {
          const absolutePath = fixLine(
            path
              .relative(
                './@types',
                pathMatch ? path.join(packagePath, pathMatch[1].replace("'", '')) : packagePath
              )
              .replace('index.ts', '')
          );
          const exportStatement = `type ${statementMatch[0]}`;
          exportStatements.push({
            statements: [exportStatement],
            source: absolutePath,
          });
        }
      } else {
        console.log('something else found!', chalk.redBright(line));
      }
    }
  }
  return exportStatements;
};

const declarePackage = async (_packageName: string, handleImports: boolean = false) => {
  const packageName = getPackageName(_packageName);
  let packagePath = await locatePackage(packageName);
  const formattedPackageName = chalk.cyan(packageName);

  if (!packagePath) {
    logger.error(`Package ${formattedPackageName} does not exist`);
    process.exit(1);
  }

  packagePath = !packagePath.includes('src') ? path.join(packagePath, 'src') : packagePath;

  logger.log(`Declaring package ${formattedPackageName}`);

  try {
    const startTime = Date.now();

    const fileContent: string | null =
      packagePath && fixFileContent(fs.readFileSync(path.join(packagePath, 'index.ts'), 'utf-8'));

    const exportStatements: ExportStatement[] | null = fileContent
      ? findExportStatement(packageName, fileContent, packagePath)
      : null;

    const groupedStatements: ExportStatement[] = [];

    if (exportStatements && exportStatements.length) {
      exportStatements.forEach(({ statements, source }: ExportStatement) => {
        const foundIndex: number = groupedStatements.findIndex(
          (statement: ExportStatement) => statement.source === source
        );
        if (foundIndex > -1) {
          groupedStatements[foundIndex] = {
            ...groupedStatements[foundIndex],
            statements: groupedStatements[foundIndex].statements.concat(statements),
          };
        } else {
          groupedStatements.push({ source, statements });
        }
      });

      if (groupedStatements && Object.entries(groupedStatements).length) {
        let declareStatement = `declare module '${packageName}' {\n`;
        groupedStatements.forEach((statement: ExportStatement, index: number) => {
          declareStatement += `  export { ${statement.statements.join(', ')} } from '${statement.source}';\n`;
        });
        declareStatement += `}\n`;
        if (!handleImports) {
          fs.appendFileSync('@types/packages.d.ts', '\n');
          fs.appendFileSync('@types/packages.d.ts', declareStatement);
        }
      }
    }

    logger.success(
      `Package ${formattedPackageName} has been declared in ${chalk.green(getBuildTime(startTime))}`
    );
  } catch (err: unknown) {
    logger.error(`Failed to declare package: ${formattedPackageName}`);
    logger.error(err as Error);
    process.exit(1);
  }
};

const declareAllPackages = async () => {
  const startTime = Date.now();
  logger.log('Declaring all packages...');

  fs.writeFileSync('@types/packages.d.ts', '');

  const packages = await getPackagesBuildOrder();
  /*
  for (const item of packages) {
    if (!item!.packageJson.name) {
      process.stdout.write(`Skipping ${item!.path} because it has no name\n`);
    } else {
      await declarePackage(item!.packageJson.name, true);
    }
  }
  */
  for (const item of packages) {
    if (!item!.packageJson.name) {
      process.stdout.write(`Skipping ${item!.path} because it has no name\n`);
    } else {
      await declarePackage(item!.packageJson.name);
      // await rollbackExportFiles(item!.packageJson.name);
    }
  }

  logger.success(`All packages have been declared in ${chalk.green(getBuildTime(startTime))}`);
};

(async () => {
  await declareAllPackages();
})();
