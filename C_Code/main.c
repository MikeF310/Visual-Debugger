#include <stdio.h>
#include <stdlib.h>

int second(){
    int z = 20;

    printf("Ending main2!");
}

int main(){
    int x = 9;
    int *a = &x;
    int *b = (int *) malloc(40);
    printf("First Output!");
    second();
    return 0;
}

