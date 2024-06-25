process.on('uncaughtException', function (err) {
    console.log('Caught exception: ', err);
});

import gulp from 'gulp';
import gulpcache from 'gulp-cached';

import clean from 'gulp-clean';

import eslint from 'gulp-eslint';
import logger from 'gulp-logger';
import ts from 'gulp-typescript';

const tsProject = ts.createProject('tsconfig.json');

function onError(e) {
    console.log('Errored', e);
}

async function build() {
    return new Promise(async (resolve) => {
        tsProject
            .src()
            .pipe(gulpcache())
            .pipe(eslint())
            //.pipe(eslint.format())
            //.pipe(eslint.failAfterError())
            .pipe(
                logger({
                    before: 'Starting...',
                    after: 'Project compiled!',
                    extname: '.js',
                    showChange: true,
                }),
            )
            .pipe(tsProject())
            .on('error', onError)
            .pipe(gulp.dest('build'))
            .on('end', async () => {
                resolve();
            });
    });
}

async function cleanFiles() {
    return new Promise(async (resolve) => {
        gulp.src('./build/src', { read: false })
            .pipe(clean())
            .on('end', async () => {
                resolve();
            });
    });
}

gulp.task('default', async () => {
    await build().catch((e) => {});

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
