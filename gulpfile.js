import gulpESLintNew from 'gulp-eslint-new';
import gulp from 'gulp';
import gulpcache from 'gulp-cached';

import clean from 'gulp-clean';
import logger from 'gulp-logger';
import ts from 'gulp-typescript';

process.on('uncaughtException', function (err) {
    console.log('Caught exception: ', err);
});

process.on('unhandledRejection', (reason, p) => {
    //console.error('Unhandled Rejection at:', p, 'reason:', reason);
});

const tsProject = ts.createProject('tsconfig.json');

function onError(e) {
    console.log('Errored', e);
}

async function build() {
    return new Promise((resolve) => {
        tsProject
            .src()
            .on('error', onError)
            .pipe(gulpcache())
            .pipe(
                logger({
                    before: 'Starting...',
                    after: 'Project compiled!',
                    extname: '.js',
                    showChange: true,
                }),
            )
            .pipe(gulpESLintNew())
            .pipe(gulpESLintNew.format())
            .pipe(tsProject())
            .pipe(gulp.dest('build'))
            .on('end', async () => {
                resolve();
            });
    });
}

async function cleanFiles() {
    return new Promise((resolve) => {
        gulp.src('./build/src', { read: false })
            .pipe(clean())
            .on('end', async () => {
                resolve();
            });
    });
}

gulp.task('default', async () => {
    await build().catch(() => {});

    return true;
});

gulp.task(`clean`, async () => {
    await cleanFiles();
});

gulp.task('watch', () => {
    gulp.watch(
        ['src/**/**/*.ts', 'src/**/*.ts', 'src/**/*.js', 'src/*.ts', 'src/*.js'],
        async (cb) => {
            await build().catch((e) => {
                console.log('Errored 2', e);
            });

            cb();
        },
    );
});
